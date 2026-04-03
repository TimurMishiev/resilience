/**
 * useGlobeEngine
 *
 * Owns all Cesium lifecycle: viewer init, site/asset/AO/signal entity
 * management, ScreenSpaceEventHandler click dispatch, camera change listener,
 * and isCloseView threshold tracking.
 *
 * Design contract:
 *  - Imperative: all Cesium effects are internal; the caller passes data and
 *    callbacks, receives primitive return values.
 *  - Callback-driven: entity clicks surface through onSiteClick / onAssetClick
 *    / onSignalClick; the page owns all selection + navigation state.
 *  - Ref-wrapped callbacks: every selection callback is mirrored into a ref
 *    so the one-time ScreenSpaceEventHandler registration never goes stale.
 *  - Ref-backed dynamic data: sites/assets/signals/readings are mirrored into
 *    refs so the click handler always reads fresh data without re-registering.
 */

import { useEffect, useRef, useState, useCallback, useMemo, type RefObject } from 'react'
import type * as CesiumType from 'cesium'
import type { Site, Task, Asset, Signal, AreaOfOperation, Chokepoint } from '../api/types'
import type { VesselTrack } from '../api/vessels'
import { assetDisplayPosition, assetSeedPosition } from '../lib/assetPresentation'
import { haversineKm, type CoverageCircle } from '../lib/coverage'
import {
  FOCUSED_SIGNAL_RADIUS_KM,
  pickIdString,
  pruneEntityMap,
  prunePrimitiveMap,
  resolvePickCandidates,
  setEntityLabelDisableDepthTestDistance,
  setEntityLabelHeightReference,
  setEntityLabelText,
  setEntityPointColor,
  setEntityPointDisableDepthTestDistance,
  setEntityPointHeightReference,
  setEntityPosition,
  SIGNAL_CLOSE_VIEW_HEIGHT_M,
  siteColor,
  type CesiumModule,
  type PickInspectionResult,
} from '../lib/globeEngineHelpers'
import { nowMs, recordPerfEvent } from '../lib/perfInstrumentation'
import { preloadGlobeRuntime } from '../lib/preloadRoutes'
import { SIGNAL_COLORS } from '../lib/signalConfig'
import type { AssetTrail } from '../lib/telemetry'
import { useGlobeOverlays } from './globe/useGlobeOverlays'
import { useGlobeTrackLayers } from './globe/useGlobeTrackLayers'
import type { TelemetryMap } from '../lib/telemetry'
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

  /** Optional center point for focused signal decluttering around the current selection. */
  signalFocusCenter: { lat: number; lng: number } | null
  selectedSiteId:    string | null
  selectedAssetId:   string | null
  selectedSignalId:  string | null

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
  signalFocusCenter,
  selectedSiteId,
  selectedAssetId,
  selectedSignalId,
  onSiteClick,
  onAssetClick,
  onSignalClick,
}: GlobeEngineInput): GlobeEngineReturn {
  const viewerRef       = useRef<CesiumType.Viewer | null>(null)
  const cesiumRef       = useRef<CesiumModule | null>(null)
  const siteEntitiesRef  = useRef<Map<string, CesiumType.Entity>>(new Map())
  const assetEntitiesRef = useRef<Map<string, CesiumType.Entity>>(new Map())
  // Overlay + track entity maps are managed by useGlobeOverlays and useGlobeTrackLayers below

  // High-volume point features use PointPrimitiveCollection to avoid Entity API overhead
  const signalCollectionRef = useRef<CesiumType.PointPrimitiveCollection | null>(null)
  const signalPrimitivesRef = useRef<Map<string, CesiumType.PointPrimitive>>(new Map())

  // Dynamic-data refs — kept fresh so the one-time click handler never stales
  const sitesRef    = useRef<Site[]>(sites)
  const assetsRef   = useRef<Asset[]>(assets)
  const signalsRef  = useRef<Signal[]>(signals)
  const readingsRef = useRef<TelemetryMap>(readings)

  useEffect(() => { sitesRef.current   = sites         }, [sites])
  useEffect(() => { assetsRef.current  = assets        }, [assets])
  useEffect(() => { readingsRef.current = readings     }, [readings])

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
  const previousVisibleSignalCountRef = useRef(0)
  const previousSignalFocusModeRef = useRef<'global' | 'focused'>('global')
  const previousShowSignalsRef = useRef(showSignals)

  const visibleSignals = useMemo(() => {
    if (!signalFocusCenter) return signals
    return signals.filter(signal =>
      signal.id === selectedSignalId ||
      haversineKm(signalFocusCenter.lat, signalFocusCenter.lng, Number(signal.lat), Number(signal.lng)) <= FOCUSED_SIGNAL_RADIUS_KM,
    )
  }, [selectedSignalId, signalFocusCenter, signals])

  // Signals are drawn using PointPrimitiveCollection which handles high-volume point sets efficiently.
  // We still keep selection-focused decluttering so the globe does not become unreadable around the
  // currently inspected site/asset/signal.
  useEffect(() => {
    signalsRef.current = visibleSignals
  }, [visibleSignals])

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

    // Capture ref values so cleanup uses the same Map instances (not a later re-render's refs)
    const siteEntities   = siteEntitiesRef.current
    const assetEntities  = assetEntitiesRef.current
    const signalPrimitives = signalPrimitivesRef.current

    return () => {
      cancelled = true
      setViewerReady(false)
      // Overlay + track entity cleanup is handled by their respective sub-hooks
      // (useGlobeOverlays, useGlobeTrackLayers) — they react to viewerReady going false.
      viewerRef.current?.destroy()
      viewerRef.current = null
      cesiumRef.current = null
      siteEntities.clear()
      assetEntities.clear()
      signalPrimitives.clear()
      signalCollectionRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- containerRef and creditsRef are stable; run once
  }, [])

  // ---------------------------------------------------------------------------
  // Site entities — incremental add/update/remove
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const currentIds = new Set(sites.map(s => `site-${s.id}`))
    pruneEntityMap(viewer, siteEntitiesRef.current, currentIds)

    if (sites.length === 0) return

    for (const site of sites) {
      const siteTasks = tasksBySite[site.id] ?? []
      const color     = siteColor(Cesium, siteTasks, site.status)
      const key       = `site-${site.id}`

      const existing = siteEntitiesRef.current.get(key)
      if (existing) {
        existing.name = site.name
        setEntityPosition(Cesium, existing, Number(site.longitude), Number(site.latitude))
        setEntityPointColor(Cesium, existing, color)
        setEntityPointHeightReference(Cesium, existing, Cesium.HeightReference.CLAMP_TO_GROUND)
        setEntityPointDisableDepthTestDistance(Cesium, existing, 0)
        setEntityLabelText(Cesium, existing, site.name)
        setEntityLabelHeightReference(Cesium, existing, Cesium.HeightReference.CLAMP_TO_GROUND)
        setEntityLabelDisableDepthTestDistance(Cesium, existing, 0)
        continue
      }

      const entity = viewer.entities.add({
        id:       key,
        name:     site.name,
        position: Cesium.Cartesian3.fromDegrees(Number(site.longitude), Number(site.latitude)),
        point: {
          pixelSize:               16,
          color,
          outlineColor:            Cesium.Color.WHITE.withAlpha(0.8),
          outlineWidth:            2,
          disableDepthTestDistance: 0,
          heightReference:         Cesium.HeightReference.CLAMP_TO_GROUND,
          scaleByDistance:         new Cesium.NearFarScalar(1e5, 1.5, 8e6, 0.8),
        },
        label: {
          text:                    site.name,
          font:                    '600 12px "system-ui", sans-serif',
          fillColor:               Cesium.Color.WHITE,
          outlineColor:            Cesium.Color.BLACK,
          outlineWidth:            2,
          style:                   Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:             new Cesium.Cartesian2(0, -22),
          disableDepthTestDistance: 0,
          heightReference:         Cesium.HeightReference.CLAMP_TO_GROUND,
          translucencyByDistance:  new Cesium.NearFarScalar(1e6, 1.0, 8e6, 0.0),
        },
      })
      siteEntitiesRef.current.set(key, entity)
    }
  }, [viewerReady, sites, tasksBySite])

  // ---------------------------------------------------------------------------
  // Asset entities — created once from home-site seed, then repositioned
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const currentIds = new Set(assets.map(a => `asset-${a.id}`))
    pruneEntityMap(viewer, assetEntitiesRef.current, currentIds)

    if (assets.length === 0) return

    for (const asset of assets) {
      const key      = `asset-${asset.id}`
      const existing = assetEntitiesRef.current.get(key)
      if (existing) {
        existing.name = asset.name
        setEntityLabelText(Cesium, existing, asset.name)
        setEntityPointHeightReference(Cesium, existing, Cesium.HeightReference.CLAMP_TO_GROUND)
        setEntityPointDisableDepthTestDistance(Cesium, existing, 0)
        setEntityLabelHeightReference(Cesium, existing, Cesium.HeightReference.CLAMP_TO_GROUND)
        setEntityLabelDisableDepthTestDistance(Cesium, existing, 0)
        continue
      }

      const homeSite = sites.find(s => s.id === asset.home_site_id)
      const { lat, lng } = assetSeedPosition(asset.id, homeSite)

      const entity = viewer.entities.add({
        id:       key,
        name:     asset.name,
        position: Cesium.Cartesian3.fromDegrees(lng, lat),
        point: {
          pixelSize:               10,
          color:                   Cesium.Color.CYAN.withAlpha(0.95),
          outlineColor:            Cesium.Color.WHITE.withAlpha(0.7),
          outlineWidth:            2,
          disableDepthTestDistance: 0,
          heightReference:         Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text:                    asset.name,
          font:                    '500 10px "system-ui", sans-serif',
          fillColor:               Cesium.Color.CYAN,
          outlineColor:            Cesium.Color.BLACK,
          outlineWidth:            2,
          style:                   Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:             new Cesium.Cartesian2(0, -16),
          disableDepthTestDistance: 0,
          heightReference:         Cesium.HeightReference.CLAMP_TO_GROUND,
          translucencyByDistance:  new Cesium.NearFarScalar(5e5, 1.0, 3e6, 0.0),
        },
      })
      assetEntitiesRef.current.set(key, entity)
    }
  }, [viewerReady, assets, sites])

  // ---------------------------------------------------------------------------
  // Asset position updates — driven by telemetry tick
  // isReplaying and asOf are included so positions recompute on replay changes
  // even when assets/readings identity has not changed.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const Cesium = cesiumRef.current
    if (!viewerReady || !viewerRef.current || !Cesium) return
    for (const asset of assets) {
      const entity = assetEntitiesRef.current.get(`asset-${asset.id}`)
      if (!entity) continue
      const { lat, lng } = assetDisplayPosition(asset, sites, readings, { lat: 0, lng: 0 }, { allowHistorical: isReplaying })
      setEntityPosition(Cesium, entity, lng, lat)
    }
  }, [viewerReady, assets, readings, sites, isReplaying, asOf])

  // ---------------------------------------------------------------------------
  // Overlay layers — AO, geofence, breach, coverage, chokepoints, heatmap
  // (delegated to useGlobeOverlays for maintainability)
  // ---------------------------------------------------------------------------
  const { getOverlayEntity } = useGlobeOverlays({
    viewerRef, cesiumRef, viewerReady,
    sites, areaOfOperations, breachedSiteIds, coverageCircles, chokepoints, signals,
    showCoverage, showChokepoints, showSignals, showHeatmap, isCloseView,
  })

  // ---------------------------------------------------------------------------
  // Track layers — vessel track + asset trails
  // (delegated to useGlobeTrackLayers for maintainability)
  // ---------------------------------------------------------------------------
  const { getTrackEntity } = useGlobeTrackLayers({
    viewerRef, cesiumRef, viewerReady,
    vesselTracks, assetTrails, showTrails,
  })

  // ---------------------------------------------------------------------------
  // Signal entities — migrate to PointPrimitiveCollection for mass rendering
  // Reduces heavy churn: toggles visibility instantly on the primitive collection,
  // and natively culls closely-viewed signals using DistanceDisplayCondition
  // without reacting to thousands of point changes per frame.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    const collection = signalCollectionRef.current
    if (!viewerReady || !viewer || !Cesium || !collection) return

    const startedAt = nowMs()
    const previousShowSignals = previousShowSignalsRef.current
    const previousVisibleCount = previousVisibleSignalCountRef.current
    const previousFocusMode = previousSignalFocusModeRef.current
    const nextFocusMode: 'global' | 'focused' = signalFocusCenter ? 'focused' : 'global'

    collection.show = showSignals

    if (!showSignals) {
      recordPerfEvent('globe.signal_visibility', {
        action: previousShowSignals ? 'hide' : 'steady-hidden',
        previousVisibleCount,
        nextVisibleCount: 0,
        collectionCount: signalPrimitivesRef.current.size,
      }, nowMs() - startedAt)
      previousShowSignalsRef.current = showSignals
      previousVisibleSignalCountRef.current = 0
      previousSignalFocusModeRef.current = nextFocusMode
      return
    }

    const currentIds = new Set(visibleSignals.map(s => `signal-${s.id}`))
    const removedCount = prunePrimitiveMap(collection, signalPrimitivesRef.current, currentIds)
    let updatedCount = 0
    let addedCount = 0

    const distanceDisplayCondition = new Cesium.DistanceDisplayCondition(SIGNAL_CLOSE_VIEW_HEIGHT_M, Number.MAX_VALUE)

    for (const signal of visibleSignals) {
      const key      = `signal-${signal.id}`
      const existing = signalPrimitivesRef.current.get(key)
      const position = Cesium.Cartesian3.fromDegrees(Number(signal.lng), Number(signal.lat))
      
      if (existing) {
        existing.position = position
        existing.disableDepthTestDistance = 0
        existing.distanceDisplayCondition = distanceDisplayCondition
        updatedCount += 1
        continue
      }

      const color = Cesium.Color.fromCssColorString(SIGNAL_COLORS[signal.signal_type] ?? '#ffffff')
      const primitive = collection.add({
        id:            key,
        position,
        pixelSize:     8,
        color:         color.withAlpha(0.95),
        outlineColor:  color.withAlpha(0.35),
        outlineWidth:  3,
        disableDepthTestDistance: 0,
        distanceDisplayCondition,
      })
      signalPrimitivesRef.current.set(key, primitive)
      addedCount += 1
    }

    const transition =
      previousFocusMode === nextFocusMode
        ? (previousShowSignals ? 'steady' : 'show')
        : `${previousFocusMode}_to_${nextFocusMode}`

    recordPerfEvent('globe.signal_reconcile', {
      transition,
      previousVisibleCount,
      nextVisibleCount: visibleSignals.length,
      addedCount,
      updatedCount,
      removedCount,
      showSignals,
      selectedSignalId,
      focusedSignalCountDelta: visibleSignals.length - previousVisibleCount,
    }, nowMs() - startedAt)

    previousShowSignalsRef.current = showSignals
    previousVisibleSignalCountRef.current = visibleSignals.length
    previousSignalFocusModeRef.current = nextFocusMode
  }, [viewerReady, selectedSignalId, showSignals, signalFocusCenter, visibleSignals])

  // ---------------------------------------------------------------------------
  // ScreenSpaceEventHandler — created once after viewer init
  // Reads all entity data via refs so the registration never goes stale.
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
  // Clear signal selection when signals are hidden
  // (Done in GlobePage by watching showSignals; hook does not own signal selection)
  // ---------------------------------------------------------------------------

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
  }, [getOverlayEntity, getTrackEntity])

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
