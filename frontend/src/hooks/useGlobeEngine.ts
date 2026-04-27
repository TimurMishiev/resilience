/**
 * useGlobeEngine
 *
 * Owns all Cesium lifecycle: viewer init, ScreenSpaceEventHandler click
 * dispatch, camera change listener, and isCloseView threshold tracking.
 *
 * Entity management is delegated to sub-hooks:
 *  - useGlobeSiteEntities    — site point + label entities
 *  - useGlobeAssetEntities   — asset point + label entities + telemetry positioning
 *  - useGlobeSignalPrimitives — high-volume signal PointPrimitiveCollection
 *  - useGlobeOverlays        — AO polygons, geofence, breach, coverage, chokepoints, heatmap
 *  - useGlobeTrackLayers     — vessel track + asset trail polylines
 *
 * Design contract:
 *  - Imperative: all Cesium effects are internal; the caller passes data and
 *    callbacks, receives primitive return values.
 *  - Callback-driven: entity clicks surface through onSiteClick / onAssetClick
 *    / onSignalClick; the page owns all selection + navigation state.
 *  - Ref-wrapped callbacks: every selection callback is mirrored into a ref
 *    so the one-time ScreenSpaceEventHandler registration never goes stale.
 *  - Ref-backed dynamic data: sites/assets/visibleSignals are mirrored into
 *    refs so the click handler always reads fresh data without re-registering.
 */

import { useEffect, useMemo, useRef, useState, useCallback, type RefObject } from 'react'
import type * as CesiumType from 'cesium'
import type { Site, Task, Asset, Signal, AreaOfOperation, Chokepoint } from '../api/types'
import type { VesselTrack } from '../api/vessels'
import type { CoverageCircle } from '../lib/coverage'
import {
  pickIdString,
  resolvePickCandidates,
  SIGNAL_CLOSE_VIEW_HEIGHT_M,
  type CesiumModule,
  type PickInspectionResult,
} from '../lib/globeEngineHelpers'
import { nowMs, recordPerfEvent } from '../lib/perfInstrumentation'
import { preloadGlobeRuntime } from '../lib/preloadRoutes'
import type { AssetTrail } from '../lib/telemetry'
import type { TelemetryMap } from '../lib/telemetry'
import { useGlobeSiteEntities } from './globe/useGlobeSiteEntities'
import { useGlobeAssetEntities } from './globe/useGlobeAssetEntities'
import { useGlobeSignalPrimitives } from './globe/useGlobeSignalPrimitives'
import { useGlobeOverlays } from './globe/useGlobeOverlays'
import { useGlobeTrackLayers } from './globe/useGlobeTrackLayers'
import { useGlobeReplayPulseLayers } from './globe/useGlobeReplayPulseLayers'
import { useGlobeConfidenceHaloPrimitives } from './globe/useGlobeConfidenceHaloPrimitives'
import type { ActiveSiteConfidence } from '../api/signal_rule_matches'
import type { Pulse } from '../lib/replayEventPulses'
const ionToken = import.meta.env['VITE_CESIUM_ION_TOKEN'] as string | undefined

// ---------------------------------------------------------------------------
// Hook interface
// ---------------------------------------------------------------------------

export interface GlobeEngineInput {
  containerRef: RefObject<HTMLDivElement | null>
  creditsRef:   RefObject<HTMLDivElement | null>

  // Rendered data
  sites:            Site[]
  assets:           Asset[]
  /** Full signal set; hook applies close-view + focus-radius filtering internally. */
  signals:          Signal[]
  tasksBySite:      Record<string, Task[]>
  areaOfOperations: AreaOfOperation[]
  breachedSiteIds:  Set<string>
  coverageCircles:  CoverageCircle[]
  chokepoints:      Chokepoint[]
  vesselTracks:     VesselTrack[]
  assetTrails:      AssetTrail[]
  readings:         TelemetryMap

  // Feature toggles
  showSignals:     boolean
  showHeatmap:     boolean
  showCoverage:    boolean
  showChokepoints: boolean
  showTrails:      boolean

  // Included in position-update dep array so asset positions recompute on
  // replay state changes even when assets/readings identity is unchanged.
  asOf:        string | undefined
  isReplaying: boolean
  /**
   * Live-or-replay reference clock from useReferenceTimeMs. Consumed by
   * useGlobeAssetEntities to derive per-asset freshness state, which modulates
   * the asset dot's fill alpha. The clock itself is replay-aware at the call
   * site (GlobePage.useReferenceTimeMs(asOf)), so this hook doesn't need to
   * branch on isReplaying.
   */
  referenceTimeMs: number

  /**
   * Sites linked to the currently selected signal via rule matches. Populated
   * by useEvidenceLinkedIds when a signal is selected; empty array otherwise.
   * Mirrors useMapLibreEngine's evidenceSiteIds contract so map and globe
   * render the same set of evidence-linked sites for the same selection.
   */
  evidenceSiteIds: string[]

  /**
   * Signals linked to the currently selected site via rule matches. Companion
   * to evidenceSiteIds — useEvidenceLinkedIds returns both halves. Drives the
   * amber outline on globe signal primitives.
   */
  evidenceSignalIds: string[]

  /** Optional center point for focused signal decluttering around the current selection. */
  signalFocusCenter: { lat: number; lng: number } | null
  selectedSiteId:    string | null
  selectedAssetId:   string | null
  selectedSignalId:  string | null

  // Replay event pulses (Tranche 6-B) — empty array in live mode.
  // Globe parity for the map's replay-pulse layer; same Pulse[] data
  // shape produced by useReplayEventPulses.
  replayPulses:     readonly Pulse[]
  showReplayPulses: boolean

  // Tranche 6-D-globe: replay-only confidence halos. Same raw
  // backend summaries (`{ site_id, confidence }`) the map consumes;
  // surface-specific missing-site drop happens in the sub-hook.
  // Empty array in live mode (gated at the page call site).
  // `isReplaying` is already on the engine input above.
  confidenceHaloSummaries: readonly ActiveSiteConfidence[]

  // Selection callbacks — hook fires, page owns state
  onSiteClick:   (siteId: string | null)   => void
  onAssetClick:  (assetId: string | null)  => void
  onSignalClick: (signalId: string | null) => void
}

export interface GlobeEngineReturn {
  /** True when the Cesium viewer and primitive collections are initialized */
  viewerReady:   boolean
  /** True when the camera is below SIGNAL_CLOSE_VIEW_HEIGHT_M */
  isCloseView:   boolean
  /** Fly to a lat/lng with a given altitude and optional pitch */
  focusPosition: (lng: number, lat: number, height: number, pitch?: number) => void
  /** Fly back to the full-earth home view */
  flyToHome:     () => void
  /** Project a world position into canvas coordinates for test instrumentation */
  projectPosition: (lng: number, lat: number) => { x: number; y: number } | null
  /** Project an existing rendered entity or primitive into canvas coordinates */
  projectRenderedPosition: (idString: string) => { x: number; y: number } | null
  /** Inspect the Cesium pick result at a given canvas position without mutating selection state */
  inspectCanvasPosition: (x: number, y: number) => PickInspectionResult
  /** Exercise the same overlay passthrough resolver with a synthetic pick stack */
  dispatchSyntheticPick: (idStrings: string[]) => boolean
  /** Resolve the same Cesium drill-pick path used by real left-click handling */
  pickCanvasPosition: (x: number, y: number) => boolean
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGlobeEngine({
  containerRef,
  creditsRef,
  sites,
  assets,
  signals,
  tasksBySite,
  areaOfOperations,
  breachedSiteIds,
  coverageCircles,
  chokepoints,
  vesselTracks,
  assetTrails,
  readings,
  showSignals,
  showHeatmap,
  showCoverage,
  showChokepoints,
  showTrails,
  asOf,
  isReplaying,
  referenceTimeMs,
  evidenceSiteIds,
  evidenceSignalIds,
  signalFocusCenter,
  selectedSiteId,
  selectedAssetId,
  selectedSignalId,
  replayPulses,
  showReplayPulses,
  confidenceHaloSummaries,
  onSiteClick,
  onAssetClick,
  onSignalClick,
}: GlobeEngineInput): GlobeEngineReturn {
  const viewerRef       = useRef<CesiumType.Viewer | null>(null)
  const cesiumRef       = useRef<CesiumModule | null>(null)

  // High-volume point features use PointPrimitiveCollection to avoid Entity API overhead
  const signalCollectionRef = useRef<CesiumType.PointPrimitiveCollection | null>(null)

  // Dynamic-data refs — kept fresh so the one-time click handler never stales
  const sitesRef    = useRef<Site[]>(sites)
  const assetsRef   = useRef<Asset[]>(assets)

  useEffect(() => { sitesRef.current   = sites         }, [sites])
  useEffect(() => { assetsRef.current  = assets        }, [assets])

  const selectedSiteIdRef = useRef<string | null>(selectedSiteId)
  const selectedAssetIdRef = useRef<string | null>(selectedAssetId)
  const selectedSignalIdRef = useRef<string | null>(selectedSignalId)
  useEffect(() => { selectedSiteIdRef.current = selectedSiteId }, [selectedSiteId])
  useEffect(() => { selectedAssetIdRef.current = selectedAssetId }, [selectedAssetId])
  useEffect(() => { selectedSignalIdRef.current = selectedSignalId }, [selectedSignalId])

  // Callback refs — prevent stale closures in the one-time handler registration
  const onSiteClickRef   = useRef(onSiteClick)
  const onAssetClickRef  = useRef(onAssetClick)
  const onSignalClickRef = useRef(onSignalClick)
  useEffect(() => { onSiteClickRef.current   = onSiteClick   }, [onSiteClick])
  useEffect(() => { onAssetClickRef.current  = onAssetClick  }, [onAssetClick])
  useEffect(() => { onSignalClickRef.current = onSignalClick }, [onSignalClick])

  const [viewerReady, setViewerReady] = useState(false)
  const [isCloseView, setIsCloseView] = useState(false)

  // ---------------------------------------------------------------------------
  // Viewer init — runs once
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return
    let cancelled = false

    void preloadGlobeRuntime().then(Cesium => {
      if (cancelled || !containerRef.current || viewerRef.current) return
      cesiumRef.current = Cesium
      if (ionToken) Cesium.Ion.defaultAccessToken = ionToken

      const osmProvider = new Cesium.UrlTemplateImageryProvider({
        url:          'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
        credit:       new Cesium.Credit('© Esri, Maxar, Earthstar Geographics'),
      })

      const viewer = new Cesium.Viewer(containerRef.current, {
        baseLayer: Cesium.ImageryLayer.fromProviderAsync(Promise.resolve(osmProvider), {}),
        terrainProvider: new Cesium.EllipsoidTerrainProvider({}),
        baseLayerPicker:      false,
        geocoder:             false,
        homeButton:           false,
        infoBox:              false,
        navigationHelpButton: false,
        sceneModePicker:      false,
        selectionIndicator:   false,
        timeline:             false,
        animation:            false,
        fullscreenButton:     false,
        creditContainer:      creditsRef.current ?? undefined,
      })

      viewer.scene.backgroundColor = Cesium.Color.BLACK
      viewer.scene.globe.depthTestAgainstTerrain = true
      viewer.scene.globe.enableLighting = true
      viewer.scene.globe.showGroundAtmosphere = true
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0a0f1a')
      viewer.scene.screenSpaceCameraController.minimumZoomDistance = 900_000
      viewer.scene.screenSpaceCameraController.maximumZoomDistance = 30_000_000
      viewer.scene.screenSpaceCameraController.maximumTiltAngle = Cesium.Math.toRadians(65)
      viewer.scene.screenSpaceCameraController.inertiaSpin = 0
      viewer.scene.screenSpaceCameraController.inertiaTranslate = 0
      viewer.scene.screenSpaceCameraController.inertiaZoom = 0
      if (viewer.scene.skyAtmosphere) {
        viewer.scene.skyAtmosphere.show = true
        viewer.scene.skyAtmosphere.atmosphereLightIntensity = 20.0
        viewer.scene.skyAtmosphere.atmosphereRayleighScaleHeight = 12000
      }
      viewer.scene.fog.enabled = false
      if (viewer.scene.skyBox) viewer.scene.skyBox.show = true

      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(10, 20, 18_000_000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
      })

      const scratchCartographic = new Cesium.Cartographic()
      viewer.camera.changed.addEventListener(() => {
        Cesium.Cartographic.fromCartesian(viewer.camera.position, undefined, scratchCartographic)
        const close = scratchCartographic.height < SIGNAL_CLOSE_VIEW_HEIGHT_M
        setIsCloseView(prev => prev === close ? prev : close)
      })

      const signalCollection = new Cesium.PointPrimitiveCollection()
      viewer.scene.primitives.add(signalCollection)
      signalCollectionRef.current = signalCollection

      viewerRef.current = viewer
      setViewerReady(true)
    })

    return () => {
      cancelled = true
      setViewerReady(false)
      viewerRef.current?.destroy()
      viewerRef.current = null
      cesiumRef.current = null
      signalCollectionRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- containerRef and creditsRef are stable; run once
  }, [])

  // ---------------------------------------------------------------------------
  // Cross-entity spatial linking
  // ---------------------------------------------------------------------------
  // When an asset is selected, linked-highlight its home site. When a site is
  // selected, linked-highlight every asset rooted at that site. Mirrors the
  // useMapLibreEngine pattern so the two surfaces share a visual contract.
  const selectedAssetHomeSiteId = useMemo(
    () => assets.find(a => a.id === selectedAssetId)?.home_site_id ?? null,
    [assets, selectedAssetId],
  )

  // ---------------------------------------------------------------------------
  // Sub-hooks — entity management delegated for maintainability
  // ---------------------------------------------------------------------------
  const { siteEntitiesRef } = useGlobeSiteEntities({
    viewerRef, cesiumRef, viewerReady, sites, tasksBySite,
    linkedSiteId: selectedAssetHomeSiteId,
    evidenceSiteIds,
  })

  const { assetEntitiesRef } = useGlobeAssetEntities({
    viewerRef, cesiumRef, viewerReady, sites, assets, readings, isReplaying, asOf,
    linkedSiteId: selectedSiteId,
    referenceTimeMs,
  })

  const { signalPrimitivesRef, visibleSignals } = useGlobeSignalPrimitives({
    viewerRef, cesiumRef, viewerReady, signals, showSignals, selectedSignalId, signalFocusCenter, signalCollectionRef,
    evidenceSignalIds,
  })

  // Keep signalsRef fresh for click handler
  const signalsRef = useRef<Signal[]>(visibleSignals)
  useEffect(() => { signalsRef.current = visibleSignals }, [visibleSignals])

  const { getOverlayEntity } = useGlobeOverlays({
    viewerRef, cesiumRef, viewerReady,
    sites, areaOfOperations, breachedSiteIds, coverageCircles, chokepoints, signals,
    showCoverage, showChokepoints, showSignals, showHeatmap, isCloseView,
  })

  const { getTrackEntity } = useGlobeTrackLayers({
    viewerRef, cesiumRef, viewerReady,
    vesselTracks, assetTrails, showTrails,
  })

  // Replay event pulses (Tranche 6-B). Mounts only when showReplayPulses
  // is true; live mode + empty pulses pay zero per-frame cost. Owns its
  // own PointPrimitiveCollection lifecycle separately from the signal
  // collection (per scoping decision — keeps cleanup and future 6-D halo
  // work isolated).
  useGlobeReplayPulseLayers({
    viewerRef, cesiumRef, viewerReady,
    pulses: replayPulses,
    showReplayPulses,
  })

  // Tranche 6-D-globe: replay-only confidence halos. Owns its own
  // PointPrimitiveCollection lifecycle separately from the replay
  // pulse and signal collections — clean teardown on replay exit.
  // Live mode renders nothing because the page-level fetch is
  // gated on `isReplaying`, so summaries is `[]`.
  useGlobeConfidenceHaloPrimitives({
    viewerRef, cesiumRef, viewerReady,
    sites,
    summaries: confidenceHaloSummaries,
    isReplaying,
  })

  // ---------------------------------------------------------------------------
  // ScreenSpaceEventHandler — click dispatch
  // ---------------------------------------------------------------------------
  const inspectCanvasPosition = useCallback((x: number, y: number) => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return { outcome: 'invalid' as const }

    const picks = viewer.scene.drillPick(new Cesium.Cartesian2(x, y))
    const candidates = Cesium.defined(picks)
      ? picks
          .map(pickIdString)
          .filter((candidate): candidate is { idString: string; pickedKind: 'primitive' | 'entity' } => candidate !== null)
      : []

    return resolvePickCandidates(candidates, sitesRef.current, assetsRef.current, signalsRef.current)
  }, [viewerReady])

  const dispatchPickResult = useCallback((result: PickInspectionResult, durationMs?: number) => {
    if (result.outcome === 'site' && result.idString) {
      const siteId = result.idString.replace('site-', '')
      onSiteClickRef.current(selectedSiteIdRef.current === siteId ? null : siteId)
      if (durationMs != null) recordPerfEvent('globe.pick', { outcome: result.outcome, pickedKind: result.pickedKind, id: siteId }, durationMs)
      return true
    }

    if (result.outcome === 'asset' && result.idString) {
      const assetId = result.idString.replace('asset-', '')
      onAssetClickRef.current(selectedAssetIdRef.current === assetId ? null : assetId)
      if (durationMs != null) recordPerfEvent('globe.pick', { outcome: result.outcome, pickedKind: result.pickedKind, id: assetId }, durationMs)
      return true
    }

    if (result.outcome === 'signal' && result.idString) {
      const signalId = result.idString.replace('signal-', '')
      onSignalClickRef.current(selectedSignalIdRef.current === signalId ? null : signalId)
      if (durationMs != null) recordPerfEvent('globe.pick', { outcome: result.outcome, pickedKind: result.pickedKind, id: signalId }, durationMs)
      return true
    }

    if (durationMs != null && result.idString) {
      recordPerfEvent('globe.pick', { outcome: result.outcome, pickedKind: result.pickedKind, id: result.idString }, durationMs)
      return false
    }

    if (durationMs != null) recordPerfEvent('globe.pick', { outcome: result.outcome }, durationMs)
    return false
  }, [])

  const dispatchSyntheticPick = useCallback((idStrings: string[]) => {
    const candidates = idStrings.map(idString => ({ idString, pickedKind: 'entity' as const }))
    const result = resolvePickCandidates(candidates, sitesRef.current, assetsRef.current, signalsRef.current)
    return dispatchPickResult(result)
  }, [dispatchPickResult])

  const pickCanvasPosition = useCallback((x: number, y: number) => {
    const startedAt = nowMs()
    const result = inspectCanvasPosition(x, y)
    return dispatchPickResult(result, nowMs() - startedAt)
  }, [dispatchPickResult, inspectCanvasPosition])

  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    handler.setInputAction(
      (event: { position: CesiumType.Cartesian2 }) => {
        pickCanvasPosition(event.position.x, event.position.y)
      },
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    )

    return () => handler.destroy()
  }, [pickCanvasPosition, viewerReady])

  // ---------------------------------------------------------------------------
  // Stable return values
  // ---------------------------------------------------------------------------
  const focusPosition = useCallback((lng: number, lat: number, height: number, pitch = -65) => {
    const Cesium = cesiumRef.current
    if (!Cesium) return
    viewerRef.current?.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lng, lat, height),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(pitch), roll: 0 },
      duration: 1.35,
    })
  }, [])

  const flyToHome = useCallback(() => {
    const Cesium = cesiumRef.current
    if (!Cesium) return
    viewerRef.current?.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(10, 20, 18_000_000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
      duration: 1.5,
    })
  }, [])

  const projectPosition = useCallback((lng: number, lat: number) => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!Cesium || !viewer) return null

    const cartesian = Cesium.Cartesian3.fromDegrees(lng, lat)
    const coordinates = viewer.scene.cartesianToCanvasCoordinates(cartesian)
    if (!coordinates) return null

    return {
      x: coordinates.x,
      y: coordinates.y,
    }
  }, [])

  const projectRenderedPosition = useCallback((idString: string) => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!Cesium || !viewer) return null

    let cartesian: CesiumType.Cartesian3 | undefined

    if (idString.startsWith('signal-')) {
      const primitive = signalPrimitivesRef.current.get(idString)
      cartesian = primitive?.position
    } else {
      const entity =
        siteEntitiesRef.current.get(idString) ??
        assetEntitiesRef.current.get(idString) ??
        getOverlayEntity(idString) ??
        getTrackEntity(idString)

      if (entity?.position) {
        cartesian = entity.position.getValue(viewer.clock.currentTime)
      }
    }

    if (!cartesian) return null

    const coordinates = viewer.scene.cartesianToCanvasCoordinates(cartesian)
    if (!coordinates) return null

    return {
      x: coordinates.x,
      y: coordinates.y,
    }
  }, [getOverlayEntity, getTrackEntity, siteEntitiesRef, assetEntitiesRef, signalPrimitivesRef])

  return {
    viewerReady,
    isCloseView,
    focusPosition,
    flyToHome,
    projectPosition,
    projectRenderedPosition,
    inspectCanvasPosition,
    dispatchSyntheticPick,
    pickCanvasPosition,
  }
}
