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
import type { Site, Task, Asset, Signal, AreaOfOperation } from '../api/types'
import { assetDisplayPosition, assetSeedPosition } from '../lib/assetPresentation'
import { haversineKm, type CoverageCircle } from '../lib/coverage'
import { nowMs, recordPerfEvent } from '../lib/perfInstrumentation'
import { preloadGlobeRuntime } from '../lib/preloadRoutes'
import { SIGNAL_COLORS } from '../lib/signalConfig'
import type { TelemetryMap } from '../lib/telemetry'

type CesiumModule = typeof import('cesium')

// ---------------------------------------------------------------------------
// Constants — only set Ion token if explicitly provided
// ---------------------------------------------------------------------------

const ionToken = import.meta.env['VITE_CESIUM_ION_TOKEN'] as string | undefined

// Below this altitude signal entities are hidden to prevent frame-rate
// degradation at high entity density.
const SIGNAL_CLOSE_VIEW_HEIGHT_M = 2_000_000
const FOCUSED_SIGNAL_RADIUS_KM = 2_000

const COVERAGE_COLOR_BY_STATUS: Record<Asset['status'], string> = {
  available: '#3ddc84',
  assigned: '#5282ff',
  degraded: '#ffb366',
  offline: '#8f99a8',
}

// ---------------------------------------------------------------------------
// Module-scope helpers (no React deps)
// ---------------------------------------------------------------------------

function siteColor(Cesium: CesiumModule, tasks: Task[], siteStatus: Site['status']): CesiumType.Color {
  if (siteStatus === 'inactive') return Cesium.Color.GRAY
  if (tasks.length === 0)        return Cesium.Color.DODGERBLUE
  if (tasks.some(t => t.workflow_status === 'blocked'))    return Cesium.Color.RED
  if (tasks.every(t => t.workflow_status === 'resolved'))  return Cesium.Color.LIMEGREEN
  if (tasks.some(t => t.workflow_status === 'in_progress')) return Cesium.Color.DODGERBLUE
  return Cesium.Color.ORANGE
}

function setEntityPosition(Cesium: CesiumModule, entity: CesiumType.Entity, lng: number, lat: number) {
  const position = Cesium.Cartesian3.fromDegrees(lng, lat)
  if (entity.position instanceof Cesium.ConstantPositionProperty) {
    entity.position.setValue(position)
    return
  }
  entity.position = new Cesium.ConstantPositionProperty(position)
}

function setEntityLabelText(Cesium: CesiumModule, entity: CesiumType.Entity, text: string) {
  if (!entity.label) return
  if (entity.label.text instanceof Cesium.ConstantProperty) {
    entity.label.text.setValue(text)
    return
  }
  entity.label.text = new Cesium.ConstantProperty(text)
}

function setEntityPointColor(Cesium: CesiumModule, entity: CesiumType.Entity, color: CesiumType.Color) {
  if (!entity.point) return
  if (entity.point.color instanceof Cesium.ConstantProperty) {
    entity.point.color.setValue(color)
    return
  }
  entity.point.color = new Cesium.ConstantProperty(color)
}

function setPolygonHierarchy(Cesium: CesiumModule, graphics: CesiumType.PolygonGraphics, positions: CesiumType.Cartesian3[]) {
  const hierarchy = new Cesium.PolygonHierarchy(positions)
  if (graphics.hierarchy instanceof Cesium.ConstantProperty) {
    graphics.hierarchy.setValue(hierarchy)
    return
  }
  graphics.hierarchy = new Cesium.ConstantProperty(hierarchy)
}

function setPolygonOutlineColor(Cesium: CesiumModule, graphics: CesiumType.PolygonGraphics, color: CesiumType.Color) {
  if (graphics.outlineColor instanceof Cesium.ConstantProperty) {
    graphics.outlineColor.setValue(color)
    return
  }
  graphics.outlineColor = new Cesium.ConstantProperty(color)
}

function setPolygonNumericProperty(
  Cesium: CesiumModule,
  property: CesiumType.Property | undefined,
  value: number,
  assign: (next: CesiumType.ConstantProperty) => void,
) {
  if (property instanceof Cesium.ConstantProperty) {
    property.setValue(value)
    return
  }
  assign(new Cesium.ConstantProperty(value))
}

function setPolygonMaterialColor(Cesium: CesiumModule, graphics: CesiumType.PolygonGraphics, color: CesiumType.Color) {
  if (graphics.material instanceof Cesium.ColorMaterialProperty) {
    if (graphics.material.color instanceof Cesium.ConstantProperty) {
      graphics.material.color.setValue(color)
      return
    }
    graphics.material.color = new Cesium.ConstantProperty(color)
    return
  }
  graphics.material = new Cesium.ColorMaterialProperty(color)
}

function setEllipseMaterialColor(Cesium: CesiumModule, graphics: CesiumType.EllipseGraphics, color: CesiumType.Color) {
  if (graphics.material instanceof Cesium.ColorMaterialProperty) {
    if (graphics.material.color instanceof Cesium.ConstantProperty) {
      graphics.material.color.setValue(color)
      return
    }
    graphics.material.color = new Cesium.ConstantProperty(color)
    return
  }
  graphics.material = new Cesium.ColorMaterialProperty(color)
}

function setEllipseColorProperty(
  Cesium: CesiumModule,
  property: CesiumType.Property | undefined,
  value: CesiumType.Color,
  assign: (next: CesiumType.ConstantProperty) => void,
) {
  if (property instanceof Cesium.ConstantProperty) {
    property.setValue(value)
    return
  }
  assign(new Cesium.ConstantProperty(value))
}

function setEllipseNumericProperty(
  Cesium: CesiumModule,
  property: CesiumType.Property | undefined,
  value: number,
  assign: (next: CesiumType.ConstantProperty) => void,
) {
  if (property instanceof Cesium.ConstantProperty) {
    property.setValue(value)
    return
  }
  assign(new Cesium.ConstantProperty(value))
}

function pruneEntityMap(
  viewer: CesiumType.Viewer,
  entityMap: Map<string, CesiumType.Entity>,
  currentIds: Set<string>,
) {
  for (const [key, entity] of entityMap) {
    if (!currentIds.has(key)) {
      viewer.entities.remove(entity)
      entityMap.delete(key)
    }
  }
}

// ---------------------------------------------------------------------------
// Primitive Collections
// ---------------------------------------------------------------------------

function prunePrimitiveMap(
  collection: CesiumType.PointPrimitiveCollection,
  primitiveMap: Map<string, CesiumType.PointPrimitive>,
  currentIds: Set<string>,
) {
  let removed = 0
  for (const [key, primitive] of primitiveMap) {
    if (!currentIds.has(key)) {
      collection.remove(primitive)
      primitiveMap.delete(key)
      removed += 1
    }
  }
  return removed
}

function pickIdString(picked: unknown): { idString: string; pickedKind: 'primitive' | 'entity' } | null {
  if (!picked || typeof picked !== 'object' || !('id' in picked)) return null
  const pickedId = (picked as { id?: unknown }).id
  if (typeof pickedId === 'string') {
    return { idString: pickedId, pickedKind: 'primitive' }
  }
  if (pickedId && typeof pickedId === 'object' && 'id' in pickedId) {
    const nestedId = (pickedId as { id?: unknown }).id
    if (typeof nestedId === 'string') {
      return { idString: nestedId, pickedKind: 'entity' }
    }
  }
  return null
}

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
  coverageCircles:  CoverageCircle[]
  readings:         TelemetryMap

  // Feature toggles
  showSignals:  boolean
  showCoverage: boolean

  // Included in position-update dep array so asset positions recompute on
  // replay state changes even when assets/readings identity is unchanged.
  asOf:        string | undefined
  isReplaying: boolean

  /** Optional center point for focused signal decluttering around the current selection. */
  signalFocusCenter: { lat: number; lng: number } | null
  selectedSignalId:  string | null

  // Selection callbacks — hook fires, page owns state
  onSiteClick:   (siteId: string)   => void
  onAssetClick:  (assetId: string)  => void
  onSignalClick: (signalId: string) => void
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
  coverageCircles,
  readings,
  showSignals,
  showCoverage,
  asOf,
  isReplaying,
  signalFocusCenter,
  selectedSignalId,
  onSiteClick,
  onAssetClick,
  onSignalClick,
}: GlobeEngineInput): GlobeEngineReturn {
  const viewerRef       = useRef<CesiumType.Viewer | null>(null)
  const cesiumRef       = useRef<CesiumModule | null>(null)
  const siteEntitiesRef  = useRef<Map<string, CesiumType.Entity>>(new Map())
  const assetEntitiesRef = useRef<Map<string, CesiumType.Entity>>(new Map())
  const aoEntitiesRef    = useRef<Map<string, CesiumType.Entity>>(new Map())
  const coverageEntitiesRef = useRef<Map<string, CesiumType.Entity>>(new Map())
  
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
    const aoEntities     = aoEntitiesRef.current
    const coverageEntities = coverageEntitiesRef.current
    const signalPrimitives = signalPrimitivesRef.current

    return () => {
      cancelled = true
      setViewerReady(false)
      viewerRef.current?.destroy()
      viewerRef.current = null
      cesiumRef.current = null
      siteEntities.clear()
      assetEntities.clear()
      aoEntities.clear()
      coverageEntities.clear()
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
        setEntityLabelText(Cesium, existing, site.name)
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
          disableDepthTestDistance: 1e7,
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
          disableDepthTestDistance: 1e7,
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
          disableDepthTestDistance: 1e7,
        },
        label: {
          text:                    asset.name,
          font:                    '500 10px "system-ui", sans-serif',
          fillColor:               Cesium.Color.CYAN,
          outlineColor:            Cesium.Color.BLACK,
          outlineWidth:            2,
          style:                   Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:             new Cesium.Cartesian2(0, -16),
          disableDepthTestDistance: 1e7,
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
  // AO polygon entities — incremental add/update/remove
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const currentIds = new Set(areaOfOperations.map(ao => `ao-${ao.id}`))
    pruneEntityMap(viewer, aoEntitiesRef.current, currentIds)

    for (const ao of areaOfOperations) {
      const key       = `ao-${ao.id}`
      const coords    = ao.geometry.coordinates[0] as [number, number][]
      const flat      = coords.flatMap(([lng, lat]) => [lng, lat])
      const positions = Cesium.Cartesian3.fromDegreesArray(flat)
      const fillColor = Cesium.Color.fromCssColorString(ao.color).withAlpha(0.15)
      const lineColor = Cesium.Color.fromCssColorString(ao.color).withAlpha(0.8)

      const existing = aoEntitiesRef.current.get(key)
      if (existing?.polygon) {
        existing.name = ao.name
        setPolygonHierarchy(Cesium, existing.polygon, positions)
        setPolygonMaterialColor(Cesium, existing.polygon, fillColor)
        setPolygonOutlineColor(Cesium, existing.polygon, lineColor)
        setPolygonNumericProperty(Cesium, existing.polygon.outlineWidth, 2, next => { existing.polygon!.outlineWidth = next })
        setPolygonNumericProperty(Cesium, existing.polygon.height, 0, next => { existing.polygon!.height = next })
        continue
      }

      const entity = viewer.entities.add({
        id:   key,
        name: ao.name,
        polygon: {
          hierarchy:    new Cesium.PolygonHierarchy(positions),
          material:     fillColor,
          outline:      new Cesium.ConstantProperty(true),
          outlineColor: new Cesium.ConstantProperty(lineColor),
          outlineWidth: new Cesium.ConstantProperty(2),
          height:       new Cesium.ConstantProperty(0),
        },
      })
      aoEntitiesRef.current.set(key, entity)
    }
  }, [viewerReady, areaOfOperations])

  // ---------------------------------------------------------------------------
  // Coverage circles — incremental add/update/remove using ellipse entities
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const keyForCircle = (circle: CoverageCircle) => [
      'coverage',
      circle.assetId,
      circle.anchorKey,
    ].join('-')

    const currentIds = new Set(coverageCircles.map(keyForCircle))
    pruneEntityMap(viewer, coverageEntitiesRef.current, currentIds)

    for (const circle of coverageCircles) {
      const key = keyForCircle(circle)
      const radiusMeters = circle.radiusKm * 1000
      const baseColor = Cesium.Color.fromCssColorString(COVERAGE_COLOR_BY_STATUS[circle.status] ?? '#8f99a8')
      const fillColor = baseColor.withAlpha(circle.status === 'degraded' ? 0.06 : 0.08)
      const outlineColor = baseColor.withAlpha(circle.status === 'degraded' ? 0.75 : 0.55)
      const outlineWidth = circle.status === 'degraded' ? 1.25 : 1.5
      const existing = coverageEntitiesRef.current.get(key)

      if (existing?.ellipse) {
        existing.show = showCoverage
        existing.name = `${circle.assetName} coverage`
        setEntityPosition(Cesium, existing, circle.anchorLng, circle.anchorLat)
        setEllipseNumericProperty(Cesium, existing.ellipse.semiMajorAxis, radiusMeters, next => { existing.ellipse!.semiMajorAxis = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.semiMinorAxis, radiusMeters, next => { existing.ellipse!.semiMinorAxis = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.height, 0, next => { existing.ellipse!.height = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.outlineWidth, outlineWidth, next => { existing.ellipse!.outlineWidth = next })
        setEllipseMaterialColor(Cesium, existing.ellipse, fillColor)
        setEllipseColorProperty(Cesium, existing.ellipse.outlineColor, outlineColor, next => { existing.ellipse!.outlineColor = next })
        continue
      }

      const entity = viewer.entities.add({
        id: key,
        name: `${circle.assetName} coverage`,
        show: showCoverage,
        position: Cesium.Cartesian3.fromDegrees(circle.anchorLng, circle.anchorLat),
        ellipse: {
          semiMajorAxis: new Cesium.ConstantProperty(radiusMeters),
          semiMinorAxis: new Cesium.ConstantProperty(radiusMeters),
          material: new Cesium.ColorMaterialProperty(fillColor),
          outline: new Cesium.ConstantProperty(true),
          outlineColor: new Cesium.ConstantProperty(outlineColor),
          outlineWidth: new Cesium.ConstantProperty(outlineWidth),
          height: new Cesium.ConstantProperty(0),
        },
      })
      coverageEntitiesRef.current.set(key, entity)
    }
  }, [coverageCircles, showCoverage, viewerReady])

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
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    handler.setInputAction(
      (event: { position: CesiumType.Cartesian2 }) => {
        const startedAt = nowMs()
        const picks = viewer.scene.drillPick(event.position)
        if (!Cesium.defined(picks) || picks.length === 0) {
          recordPerfEvent('globe.pick', { outcome: 'miss' }, nowMs() - startedAt)
          return
        }

        let resolvedPick: { idString: string; pickedKind: 'primitive' | 'entity' } | null = null
        let sawCoverage = false

        for (const picked of picks) {
          const candidate = pickIdString(picked)
          if (!candidate) continue
          if (candidate.idString.startsWith('coverage-')) {
            sawCoverage = true
            continue
          }
          resolvedPick = candidate
          break
        }

        if (!resolvedPick) {
          const outcome = sawCoverage ? 'coverage-only' : 'invalid'
          recordPerfEvent('globe.pick', { outcome }, nowMs() - startedAt)
          return
        }

        const { idString, pickedKind } = resolvedPick

        if (idString.startsWith('site-')) {
          const siteId = idString.replace('site-', '')
          if (!sitesRef.current.find(s => s.id === siteId)) {
            recordPerfEvent('globe.pick', { outcome: 'stale-site', pickedKind, id: siteId }, nowMs() - startedAt)
            return
          }
          onSiteClickRef.current(siteId)
          recordPerfEvent('globe.pick', { outcome: 'site', pickedKind, id: siteId }, nowMs() - startedAt)
          return
        }

        if (idString.startsWith('asset-')) {
          const assetId = idString.replace('asset-', '')
          if (!assetsRef.current.find(a => a.id === assetId)) {
            recordPerfEvent('globe.pick', { outcome: 'stale-asset', pickedKind, id: assetId }, nowMs() - startedAt)
            return
          }
          onAssetClickRef.current(assetId)
          recordPerfEvent('globe.pick', { outcome: 'asset', pickedKind, id: assetId }, nowMs() - startedAt)
          return
        }

        if (idString.startsWith('signal-')) {
          const signalId = idString.replace('signal-', '')
          if (!signalsRef.current.find(s => s.id === signalId)) {
            recordPerfEvent('globe.pick', { outcome: 'stale-signal', pickedKind, id: signalId }, nowMs() - startedAt)
            return
          }
          onSignalClickRef.current(signalId)
          recordPerfEvent('globe.pick', { outcome: 'signal', pickedKind, id: signalId }, nowMs() - startedAt)
          return
        }

        recordPerfEvent('globe.pick', { outcome: 'unknown-id', pickedKind, id: idString }, nowMs() - startedAt)
      },
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    )

    return () => handler.destroy()
  }, [viewerReady])

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

  return { viewerReady, isCloseView, focusPosition, flyToHome }
}
