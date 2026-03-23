import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { Button, Divider, Tag, Spinner } from '@blueprintjs/core'
import { useSites } from '../hooks/useSites'
import { useTasks } from '../hooks/useTasks'
import { useAssets } from '../hooks/useAssets'
import { useTelemetryStream } from '../hooks/useTelemetryStream'
import { useAreasOfOperation } from '../hooks/useAreasOfOperation'
import { useSignals } from '../hooks/useSignals'
import { useVessels } from '../hooks/useVessels'
import { useReplay } from '../context/ReplayContext'
import type { Asset, Site, Task, WorkflowStatus, Signal } from '../api/types'
import type { Intent } from '@blueprintjs/core'
import type { Vessel } from '../api/vessels'
import { useNavigate } from 'react-router-dom'
import { humanize } from '../utils/humanize'

// Only set Ion token if explicitly provided — never set to empty string
// which blocks all rendering in Cesium 1.100+
const ionToken = import.meta.env['VITE_CESIUM_ION_TOKEN'] as string | undefined
if (ionToken) Cesium.Ion.defaultAccessToken = ionToken

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function workflowIntent(status: WorkflowStatus): Intent {
  switch (status) {
    case 'blocked':     return 'danger'
    case 'resolved':    return 'success'
    case 'in_progress': return 'primary'
    case 'triaged':     return 'warning'
    default:            return 'none'
  }
}

function siteColor(tasks: Task[], siteStatus: Site['status']): Cesium.Color {
  if (siteStatus === 'inactive') return Cesium.Color.GRAY
  if (tasks.length === 0)        return Cesium.Color.DODGERBLUE
  if (tasks.some(t => t.workflow_status === 'blocked'))  return Cesium.Color.RED
  if (tasks.every(t => t.workflow_status === 'resolved')) return Cesium.Color.LIMEGREEN
  if (tasks.some(t => t.workflow_status === 'in_progress')) return Cesium.Color.DODGERBLUE
  return Cesium.Color.ORANGE
}

function computeReadiness(tasks: Task[]): number | null {
  const total = tasks.length
  if (total === 0) return null
  const resolved   = tasks.filter(t => t.workflow_status === 'resolved').length
  const nonBlocked = tasks.filter(t => t.workflow_status !== 'blocked').length
  return (resolved / total) * 0.6 + (nonBlocked / total) * 0.4
}

function batteryIntent(pct: number): Intent {
  if (pct < 20) return 'danger'
  if (pct < 40) return 'warning'
  return 'success'
}

function assetTypeIcon(type: Asset['asset_type']): string {
  switch (type) {
    case 'vehicle':   return 'VEH'
    case 'equipment': return 'EQP'
    case 'personnel': return 'PRS'
    default:          return 'AST'
  }
}

function headingLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(deg / 45) % 8]
}

function formatTelemetryTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function hashFraction(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i)
    hash |= 0
  }
  return ((hash >>> 0) % 10_000) / 10_000
}

function assetSeedPosition(assetId: string, homeSite: Site | undefined) {
  if (!homeSite) {
    return { lat: 0, lng: 0 }
  }

  const latOffset = (hashFraction(`${assetId}-lat`) - 0.5) * 0.05
  const lngOffset = (hashFraction(`${assetId}-lng`) - 0.5) * 0.05

  return {
    lat: Number(homeSite.latitude) + latOffset,
    lng: Number(homeSite.longitude) + lngOffset,
  }
}

const GLOBE_SIGNAL_COLORS: Record<string, Cesium.Color> = {
  aircraft_position: Cesium.Color.fromCssColorString('#00d4ff'),
  vessel_position:   Cesium.Color.fromCssColorString('#00c4a0'),
  seismic_event:     Cesium.Color.fromCssColorString('#ff8c42'),
  gps_jamming:       Cesium.Color.fromCssColorString('#ffd700'),
  wildfire:          Cesium.Color.fromCssColorString('#ff4422'),
  ais_gap:           Cesium.Color.fromCssColorString('#f7f9fb'),
  conflict_event:    Cesium.Color.fromCssColorString('#e040fb'),
  disaster_alert:    Cesium.Color.fromCssColorString('#ff4081'),
  manual:            Cesium.Color.fromCssColorString('#8f99a8'),
}

const GLOBE_SIGNAL_LABELS: Record<string, string> = {
  aircraft_position: 'Aircraft',
  vessel_position:   'Vessel',
  seismic_event:     'Seismic',
  gps_jamming:       'GPS Jam',
  wildfire:          'Wildfire',
  ais_gap:           'AIS Gap',
  conflict_event:    'Conflict',
  disaster_alert:    'Disaster',
  manual:            'Manual',
}

const SOURCE_LABELS: Record<string, string> = {
  opensky:        'OpenSky',
  ais:            'AIS',
  usgs_seismic:   'USGS Seismic',
  gpsjam:         'GPSJam',
  firms_wildfire: 'FIRMS Wildfire',
  acled:          'ACLED',
  gdacs:          'GDACS',
  manual:         'Manual',
  derived:        'Derived',
}

const ALERT_LEVEL_INTENT: Record<string, 'success' | 'warning' | 'danger'> = {
  Green:  'success',
  Orange: 'warning',
  Red:    'danger',
}

// ---------------------------------------------------------------------------
// Inspector title — extracted from nested ternary for readability
// ---------------------------------------------------------------------------
function getInspectorTitle(
  selectedSite:   Site   | null,
  selectedAsset:  Asset  | null,
  selectedSignal: Signal | null,
  selectedVessel: Vessel | null,
): string | null {
  if (selectedSite)  return selectedSite.name
  if (selectedAsset) return selectedAsset.name
  if (selectedVessel?.name) return selectedVessel.name
  if (selectedSignal?.signal_type === 'disaster_alert' && typeof selectedSignal.raw_payload.name === 'string')
    return selectedSignal.raw_payload.name
  if (selectedSignal?.signal_type === 'conflict_event' && typeof selectedSignal.raw_payload.sub_event_type === 'string')
    return selectedSignal.raw_payload.sub_event_type
  if (selectedSignal)
    return GLOBE_SIGNAL_LABELS[selectedSignal.signal_type] ?? selectedSignal.signal_type
  return null
}

// ---------------------------------------------------------------------------
// GlobePage
// ---------------------------------------------------------------------------
export default function GlobePage() {
  const FOCUSED_SIGNAL_RADIUS_KM = 2_000
  const EVENT_SIGNAL_REFRESH_MS = 60_000
  // Below this altitude Cesium renders hundreds of entities at high density,
  // causing frame-rate degradation.  Signals are hidden and the user is
  // prompted to switch to the 2D MapPage for tactical inspection.
  const SIGNAL_CLOSE_VIEW_HEIGHT_M = 2_000_000
  const navigate = useNavigate()
  const { asOf, isReplaying } = useReplay()
  const asOfParam = asOf ? { as_of: asOf } : {}
  const signalQueryParams = useMemo(
    () => (asOf ? { to: asOf, as_of: asOf } : {}),
    [asOf]
  )
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null)
  const [showSignals, setShowSignals] = useState(true)
  const [cameraHeight, setCameraHeight] = useState(18_000_000)
  const hasFocusedSelection = Boolean(selectedSiteId || selectedAssetId || selectedSignalId)
  const positionalSignalRefetchInterval = isReplaying || hasFocusedSelection ? false : 5000
  const eventSignalRefetchInterval = isReplaying || hasFocusedSelection ? false : EVENT_SIGNAL_REFRESH_MS

  const sitesQuery  = useSites({ per_page: 200, ...asOfParam })
  const tasksQuery  = useTasks({ per_page: 200, ...asOfParam })
  const assetsQuery = useAssets({ per_page: 200, ...asOfParam })
  const { data: areasRes } = useAreasOfOperation({ per_page: 200 })
  const { data: aircraftRes }  = useSignals({ signal_type: 'aircraft_position', per_page: 150, ...signalQueryParams }, { refetchInterval: positionalSignalRefetchInterval })
  const { data: vesselRes }    = useSignals({ signal_type: 'vessel_position',   per_page: 50,  ...signalQueryParams }, { refetchInterval: positionalSignalRefetchInterval })
  const { data: seismicRes }   = useSignals({ signal_type: 'seismic_event',     per_page: 50,  ...signalQueryParams }, { refetchInterval: eventSignalRefetchInterval })
  const { data: gpsJamRes }    = useSignals({ signal_type: 'gps_jamming',       per_page: 50,  ...signalQueryParams }, { refetchInterval: eventSignalRefetchInterval })
  const { data: wildfireRes }  = useSignals({ signal_type: 'wildfire',          per_page: 50,  ...signalQueryParams }, { refetchInterval: eventSignalRefetchInterval })
  const { data: conflictRes }  = useSignals({ signal_type: 'conflict_event',    per_page: 50,  ...signalQueryParams }, { refetchInterval: eventSignalRefetchInterval })
  const { data: disasterRes }  = useSignals({ signal_type: 'disaster_alert',    per_page: 50,  ...signalQueryParams }, { refetchInterval: eventSignalRefetchInterval })
  const { data: manualRes }    = useSignals({ signal_type: 'manual',            per_page: 20,  ...signalQueryParams }, { refetchInterval: eventSignalRefetchInterval })
  const { data: aisGapRes }    = useSignals({ signal_type: 'ais_gap',           per_page: 20,  ...signalQueryParams }, { refetchInterval: eventSignalRefetchInterval })

  const sites  = useMemo(() => sitesQuery.data?.data  ?? [], [sitesQuery.data?.data])
  const tasks  = useMemo(() => tasksQuery.data?.data  ?? [], [tasksQuery.data?.data])
  const assets = useMemo(() => assetsQuery.data?.data ?? [], [assetsQuery.data?.data])
  const areaOfOperations = useMemo(() => areasRes?.data ?? [], [areasRes?.data])
  const signals = useMemo(() => [
    ...(aircraftRes?.data  ?? []),
    ...(vesselRes?.data    ?? []),
    ...(seismicRes?.data   ?? []),
    ...(gpsJamRes?.data    ?? []),
    ...(wildfireRes?.data  ?? []),
    ...(conflictRes?.data  ?? []),
    ...(disasterRes?.data  ?? []),
    ...(manualRes?.data    ?? []),
    ...(aisGapRes?.data    ?? []),
  ], [
    aircraftRes?.data, vesselRes?.data, seismicRes?.data,
    gpsJamRes?.data, wildfireRes?.data, conflictRes?.data, disasterRes?.data, manualRes?.data, aisGapRes?.data,
  ])
  const loading = sitesQuery.isLoading || tasksQuery.isLoading

  const { readings, connected: telemetryConnected } = useTelemetryStream(!isReplaying)

  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef    = useRef<Cesium.Viewer | null>(null)
  const creditsRef   = useRef<HTMLDivElement>(null)
  // site entity refs for color updates
  const siteEntitiesRef  = useRef<Map<string, Cesium.Entity>>(new Map())
  // asset entity refs for position updates
  const assetEntitiesRef = useRef<Map<string, Cesium.Entity>>(new Map())
  // AO entity refs
  const aoEntitiesRef    = useRef<Map<string, Cesium.Entity>>(new Map())
  const signalEntitiesRef = useRef<Map<string, Cesium.Entity>>(new Map())
  const isRotatingRef    = useRef(false)

  const tasksBySite = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const t of tasks) {
      if (!map[t.site_id]) map[t.site_id] = []
      map[t.site_id].push(t)
    }
    return map
  }, [tasks])

  const selectedSite = selectedSiteId ? (sites.find(site => site.id === selectedSiteId) ?? null) : null
  const selectedTasks = selectedSiteId ? (tasksBySite[selectedSiteId] ?? []) : []
  const selectedAsset = selectedAssetId ? (assets.find(asset => asset.id === selectedAssetId) ?? null) : null
  const selectedReading = selectedAssetId ? (readings.get(selectedAssetId) ?? null) : null
  const selectedSignal = selectedSignalId ? (signals.find(signal => signal.id === selectedSignalId) ?? null) : null
  const selectedCenter = useMemo(() => {
    if (selectedSite) {
      return { lat: Number(selectedSite.latitude), lng: Number(selectedSite.longitude) }
    }

    if (selectedSignal) {
      return { lat: Number(selectedSignal.lat), lng: Number(selectedSignal.lng) }
    }

    if (selectedAsset) {
      const homeSite = sites.find(site => site.id === selectedAsset.home_site_id)
      const fallback = assetSeedPosition(selectedAsset.id, homeSite)
      return {
        lat: selectedReading?.lat ?? fallback.lat,
        lng: selectedReading?.lng ?? fallback.lng,
      }
    }

    return null
  }, [selectedAsset, selectedReading, selectedSignal, selectedSite, sites])
  const visibleSignals = useMemo(() => {
    if (cameraHeight < SIGNAL_CLOSE_VIEW_HEIGHT_M) return []
    if (!selectedCenter) return signals

    return signals.filter(signal =>
      signal.id === selectedSignalId ||
      haversineKm(selectedCenter.lat, selectedCenter.lng, Number(signal.lat), Number(signal.lng)) <= FOCUSED_SIGNAL_RADIUS_KM
    )
  }, [cameraHeight, selectedCenter, selectedSignalId, signals])

  // -------------------------------------------------------------------------
  // Init Cesium viewer once
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return

    // ESRI World Imagery — satellite basemap, no API key required
    const osmProvider = new Cesium.UrlTemplateImageryProvider({
      url:          'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maximumLevel: 19,
      credit:       new Cesium.Credit('© Esri, Maxar, Earthstar Geographics'),
    })

    const viewer = new Cesium.Viewer(containerRef.current, {
      // `baseLayer` accepted in 1.104+; falls back gracefully in older builds
      baseLayer: Cesium.ImageryLayer.fromProviderAsync(
        Promise.resolve(osmProvider), {}
      ),
      // Flat ellipsoid — zero Ion dependency
      terrainProvider: new Cesium.EllipsoidTerrainProvider({}),
      // Disable all default UI — we build our own
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

    // Dark scene settings — no Ion-dependent features
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
    // Atmosphere glow for realism
    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.show = true
      viewer.scene.skyAtmosphere.atmosphereLightIntensity = 20.0
      viewer.scene.skyAtmosphere.atmosphereRayleighScaleHeight = 12000
    }
    // Soft fog for depth
    viewer.scene.fog.enabled = false
    // Deeper space background
    if (viewer.scene.skyBox) {
      viewer.scene.skyBox.show = true
    }

    // Start with a full-Earth view looking straight down
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(10, 20, 18_000_000),
      orientation: {
        heading: 0,
        pitch:   Cesium.Math.toRadians(-90),
        roll:    0,
      },
    })

    viewerRef.current = viewer

    viewer.camera.moveStart.addEventListener(() => {
      isRotatingRef.current = false
    })
    // Intentionally high-frequency: every camera move fires a React state update
    // to drive the visibleSignals culling and the toolbar hint swap.
    // Do NOT throttle without considering that visibleSignals depends on cameraHeight.
    viewer.camera.changed.addEventListener(() => {
      const cartographic = Cesium.Cartographic.fromCartesian(viewer.camera.position)
      setCameraHeight(cartographic.height)
    })

    // Capture ref values so the cleanup function uses the same Map instances
    const siteEntities  = siteEntitiesRef.current
    const assetEntities = assetEntitiesRef.current
    const aoEntities    = aoEntitiesRef.current
    const signalEntities = signalEntitiesRef.current

    return () => {
      viewer.destroy()
      viewerRef.current = null
      siteEntities.clear()
      assetEntities.clear()
      aoEntities.clear()
      signalEntities.clear()
    }
  }, [])

  // -------------------------------------------------------------------------
  // Site entities — rebuild when sites/tasks change
  // -------------------------------------------------------------------------
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || sites.length === 0) return

    // Remove stale site entities
    const currentIds = new Set(sites.map(s => `site-${s.id}`))
    for (const [key, entity] of siteEntitiesRef.current) {
      if (!currentIds.has(key)) {
        viewer.entities.remove(entity)
        siteEntitiesRef.current.delete(key)
      }
    }

    for (const site of sites) {
      const siteTasks = tasksBySite[site.id] ?? []
      const color     = siteColor(siteTasks, site.status)
      const key       = `site-${site.id}`

      if (siteEntitiesRef.current.has(key)) {
        // Update color on existing entity
        const entity = siteEntitiesRef.current.get(key)!
        if (entity.point) {
          entity.point.color = new Cesium.ConstantProperty(color)
        }
        continue
      }

      const entity = viewer.entities.add({
        id:       key,
        name:     site.name,
        position: Cesium.Cartesian3.fromDegrees(
          Number(site.longitude),
          Number(site.latitude),
        ),
        point: {
          pixelSize:               16,
          color:                   color,
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, tasks])

  // -------------------------------------------------------------------------
  // Asset entities — seeded from home site, moved by telemetry
  // -------------------------------------------------------------------------
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || assets.length === 0) return

    for (const asset of assets) {
      const key = `asset-${asset.id}`
      if (assetEntitiesRef.current.has(key)) continue

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
  }, [assets, sites])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    for (const asset of assets) {
      const entity = assetEntitiesRef.current.get(`asset-${asset.id}`)
      if (!entity) continue

      const homeSite = sites.find(s => s.id === asset.home_site_id)
      const { lat, lng } = assetSeedPosition(asset.id, homeSite)
      entity.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(lng, lat)
      )
    }
  }, [assets, sites, isReplaying, asOf])

  // -------------------------------------------------------------------------
  // AO polygon entities — translucent fill + outline
  // -------------------------------------------------------------------------
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    // Remove AOs that no longer exist
    const currentIds = new Set(areaOfOperations.map(ao => `ao-${ao.id}`))
    for (const [key, entity] of aoEntitiesRef.current) {
      if (!currentIds.has(key)) {
        viewer.entities.remove(entity)
        aoEntitiesRef.current.delete(key)
      }
    }

    for (const ao of areaOfOperations) {
      const key = `ao-${ao.id}`
      if (aoEntitiesRef.current.has(key)) continue

      const coords    = ao.geometry.coordinates[0]  // [[lng, lat], ...]
      const flat      = coords.flatMap(([lng, lat]: number[]) => [lng, lat])
      const positions = Cesium.Cartesian3.fromDegreesArray(flat)
      const fillColor = Cesium.Color.fromCssColorString(ao.color).withAlpha(0.15)
      const lineColor = Cesium.Color.fromCssColorString(ao.color).withAlpha(0.8)

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
  }, [areaOfOperations])

  // -------------------------------------------------------------------------
  // Signal entities — rebuild on signal data or visibility change
  // -------------------------------------------------------------------------
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    if (!showSignals) {
      for (const entity of signalEntitiesRef.current.values()) {
        viewer.entities.remove(entity)
      }
      signalEntitiesRef.current.clear()
      return
    }

    const currentIds = new Set(visibleSignals.map(signal => `signal-${signal.id}`))

    for (const [key, entity] of signalEntitiesRef.current) {
      if (!currentIds.has(key)) {
        viewer.entities.remove(entity)
        signalEntitiesRef.current.delete(key)
      }
    }

    for (const signal of visibleSignals) {
      const key = `signal-${signal.id}`
      const color = GLOBE_SIGNAL_COLORS[signal.signal_type] ?? Cesium.Color.WHITE
      const position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(Number(signal.lng), Number(signal.lat))
      )

      const existing = signalEntitiesRef.current.get(key)
      if (existing) {
        // Only update position — color is derived from signal_type which never
        // changes for a given signal, so skip ConstantProperty allocations on
        // every tick (was 2 × N allocs per visibleSignals update).
        existing.position = position
        continue
      }

      const entity = viewer.entities.add({
        id: key,
        position,
        point: {
          pixelSize:    8,
          color:        color.withAlpha(0.95),
          outlineColor: color.withAlpha(0.35),
          outlineWidth: 3,
        },
      })
      signalEntitiesRef.current.set(key, entity)
    }
  }, [showSignals, visibleSignals])

  // -------------------------------------------------------------------------
  // Update asset positions from live telemetry
  // -------------------------------------------------------------------------
  useEffect(() => {
    for (const [assetId, reading] of readings) {
      const entity = assetEntitiesRef.current.get(`asset-${assetId}`)
      if (entity) {
        entity.position = new Cesium.ConstantPositionProperty(
          Cesium.Cartesian3.fromDegrees(reading.lng, reading.lat)
        )
      }
    }
  }, [readings])

  // -------------------------------------------------------------------------
  // Click handler — pick site, asset, or signal entity and focus it
  // -------------------------------------------------------------------------
  const focusPosition = useCallback((lng: number, lat: number, height: number, pitch = -65) => {
    const viewer = viewerRef.current
    if (!viewer) return

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lng, lat, height),
      orientation: {
        heading: 0,
        pitch:   Cesium.Math.toRadians(pitch),
        roll:    0,
      },
      duration: 1.35,
    })
  }, [])

  const handleClick = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    const stopRotation = () => {
      isRotatingRef.current = false
    }

    handler.setInputAction(stopRotation, Cesium.ScreenSpaceEventType.LEFT_DOWN)
    handler.setInputAction(stopRotation, Cesium.ScreenSpaceEventType.MIDDLE_DOWN)
    handler.setInputAction(stopRotation, Cesium.ScreenSpaceEventType.RIGHT_DOWN)
    handler.setInputAction(stopRotation, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
    handler.setInputAction(stopRotation, Cesium.ScreenSpaceEventType.WHEEL)
    handler.setInputAction(stopRotation, Cesium.ScreenSpaceEventType.PINCH_START)
    handler.setInputAction((event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      stopRotation()
      const picked = viewer.scene.pick(event.position)
      if (!Cesium.defined(picked) || !picked.id) return

      const entity: Cesium.Entity = picked.id
      if (!entity.id) return

      if (entity.id.startsWith('site-')) {
        const siteId = entity.id.replace('site-', '')
        const site = sites.find(s => s.id === siteId)
        if (!site) return

        setSelectedSiteId(site.id)
        setSelectedAssetId(null)
        setSelectedSignalId(null)
        isRotatingRef.current = false
        focusPosition(Number(site.longitude), Number(site.latitude), 1_200_000, -70)
        return
      }

      if (entity.id.startsWith('asset-')) {
        const assetId = entity.id.replace('asset-', '')
        const asset = assets.find(a => a.id === assetId)
        if (!asset) return

        const reading = readings.get(asset.id)
        const homeSite = sites.find(site => site.id === asset.home_site_id)
        const coords = reading ?? assetSeedPosition(asset.id, homeSite)

        setSelectedSiteId(null)
        setSelectedAssetId(asset.id)
        setSelectedSignalId(null)
        isRotatingRef.current = false
        focusPosition(coords.lng, coords.lat, 850_000)
        return
      }

      if (entity.id.startsWith('signal-')) {
        const signalId = entity.id.replace('signal-', '')
        const signal = signals.find(s => s.id === signalId)
        if (!signal) return

        setSelectedSiteId(null)
        setSelectedAssetId(null)
        setSelectedSignalId(signal.id)
        isRotatingRef.current = false
        focusPosition(Number(signal.lng), Number(signal.lat), 900_000)
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return () => handler.destroy()
  }, [assets, focusPosition, readings, signals, sites])

  useEffect(() => {
    const cleanup = handleClick()
    return cleanup
  }, [handleClick])

  useEffect(() => {
    if (showSignals) return
    setSelectedSignalId(null)
  }, [showSignals])
  const selectedVesselMmsi = selectedSignal?.signal_type === 'vessel_position' ? selectedSignal.external_id : null
  const { data: vesselLookup } = useVessels(
    selectedVesselMmsi ? { mmsi: selectedVesselMmsi, per_page: 1 } : undefined,
    { enabled: !!selectedVesselMmsi }
  )
  const selectedVessel = vesselLookup?.data?.[0] ?? null
  const readiness = computeReadiness(selectedTasks)
  const selectedAreaOfOperation = selectedSite?.area_of_operation_id
    ? (areaOfOperations.find(ao => ao.id === selectedSite.area_of_operation_id) ?? null)
    : null
  const nearestSignals = useMemo(() => {
    if (!selectedSite) return []

    const siteLat = Number(selectedSite.latitude)
    const siteLng = Number(selectedSite.longitude)
    return signals
      .map(signal => ({
        signal,
        distanceKm: haversineKm(siteLat, siteLng, Number(signal.lat), Number(signal.lng)),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 5)
  }, [selectedSite, signals])
  const geofenceHits = useMemo(() => {
    if (!selectedSite || !selectedSite.geofence_radius_km) return 0
    return nearestSignals.filter(item => item.distanceKm <= selectedSite.geofence_radius_km).length
  }, [nearestSignals, selectedSite])
  const nearestResponseAssets = useMemo(() => {
    if (!selectedSite) return []

    const siteLat = Number(selectedSite.latitude)
    const siteLng = Number(selectedSite.longitude)
    return assets
      .map(asset => {
        const reading = readings.get(asset.id)
        const homeSite = sites.find(site => site.id === asset.home_site_id)
        const fallback = assetSeedPosition(asset.id, homeSite)
        const lat = reading?.lat ?? fallback.lat
        const lng = reading?.lng ?? fallback.lng
        return {
          asset,
          reading,
          distanceKm: haversineKm(siteLat, siteLng, lat, lng),
        }
      })
      .sort((a, b) => {
        const statusRank = (status: Asset['status']) =>
          status === 'available' ? 0
          : status === 'assigned' ? 1
          : status === 'degraded' ? 2
          : 3
        return statusRank(a.asset.status) - statusRank(b.asset.status) || a.distanceKm - b.distanceKm
      })
      .slice(0, 4)
  }, [assets, readings, selectedSite, sites])
  const tacticalMapHref = selectedSite
    ? `/map?site_id=${selectedSite.id}`
    : selectedAsset
      ? `/map?asset_id=${selectedAsset.id}`
      : selectedSignal
        ? `/map?signal_id=${selectedSignal.id}`
        : '/map'
  const inspectorTitle = getInspectorTitle(selectedSite, selectedAsset, selectedSignal, selectedVessel)

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="globe-page">
      <div ref={containerRef} className="globe-container" />
      <div ref={creditsRef} className="globe-credits" />

      {loading && (
        <div className="globe-loading"><Spinner /></div>
      )}

      {/* ── Toolbar ── */}
      <div className="globe-toolbar bp6-dark">
        <span className="globe-toolbar-title">3D GLOBE</span>
        <Button
          small minimal icon="home"
          title="Reset view"
          onClick={() => {
            viewerRef.current?.camera.flyTo({
              destination: Cesium.Cartesian3.fromDegrees(10, 20, 18_000_000),
              orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
              duration: 1.5,
            })
            setSelectedSiteId(null)
            setSelectedAssetId(null)
            setSelectedSignalId(null)
            isRotatingRef.current = false
          }}
        />
        <div
          className={`globe-signal-toggle${showSignals ? ' globe-signal-toggle--active' : ''}`}
          onClick={() => setShowSignals(v => !v)}
          role="button"
        >
          SIGNALS {showSignals ? 'ON' : 'OFF'}
        </div>
        <span className="globe-toolbar-hint bp6-text-muted">
          {cameraHeight < SIGNAL_CLOSE_VIEW_HEIGHT_M
            ? 'Signals hidden at close range. Use the 2D map for tactical inspection.'
            : 'Click any site, asset, or signal to inspect it'}
        </span>
        {cameraHeight < SIGNAL_CLOSE_VIEW_HEIGHT_M && (
          <Button
            small
            icon="map"
            onClick={() => navigate(tacticalMapHref)}
          >
            Open Tactical Map
          </Button>
        )}
      </div>

      {/* ── Entity detail panel ── */}
      {inspectorTitle && (
        <div className="globe-panel bp6-dark">
          <div className="globe-panel-header">
            <span className="globe-panel-title">{inspectorTitle}</span>
            <button
              className="globe-panel-close bp6-button bp6-minimal bp6-icon-cross"
              onClick={() => {
                setSelectedSiteId(null)
                setSelectedAssetId(null)
                setSelectedSignalId(null)
                isRotatingRef.current = false
              }}
              aria-label="Close"
            />
          </div>

          {selectedSite && (
            <>
              <div className="globe-panel-tags">
                <Tag minimal intent={selectedSite.status === 'active' ? 'success' : 'none'}>
                  {selectedSite.status}
                </Tag>
                <Tag minimal>
                  {selectedTasks.length} task{selectedTasks.length !== 1 ? 's' : ''}
                </Tag>
                {selectedSite.geofence_radius_km > 0 && (
                  <Tag minimal intent={geofenceHits > 0 ? 'warning' : 'none'}>
                    Geofence {selectedSite.geofence_radius_km} km
                  </Tag>
                )}
                {selectedAreaOfOperation && (
                  <Tag minimal>{selectedAreaOfOperation.name}</Tag>
                )}
                {readiness !== null && (
                  <Tag minimal intent={readiness >= 0.8 ? 'success' : readiness >= 0.5 ? 'warning' : 'danger'}>
                    {Math.round(readiness * 100)}% ready
                  </Tag>
                )}
              </div>

              <p className="globe-panel-coords bp6-text-muted">
                {Number(selectedSite.latitude).toFixed(4)},&nbsp;
                {Number(selectedSite.longitude).toFixed(4)}
              </p>

              {selectedTasks.length > 0 ? (
                <>
                  <Divider />
                  <ul className="globe-task-list">
                    {selectedTasks.map(t => (
                      <li key={t.id} className="globe-task-item">
                        <span className="globe-task-title">{t.title}</span>
                        <Tag minimal intent={workflowIntent(t.workflow_status)}>
                          {humanize(t.workflow_status)}
                        </Tag>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="bp6-text-muted globe-no-tasks">No tasks assigned.</p>
              )}

              <Divider />
              <div className="globe-telemetry-readings">
                {selectedAreaOfOperation && (
                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">AO</span>
                    <span className="globe-telemetry-value">
                      {selectedAreaOfOperation.name} · {selectedAreaOfOperation.threat_level.toUpperCase()}
                    </span>
                  </div>
                )}
                {selectedSite.geofence_radius_km > 0 && (
                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">Inside ring</span>
                    <span className="globe-telemetry-value">
                      {geofenceHits} of {nearestSignals.length} nearest signals
                    </span>
                  </div>
                )}
                <div className="globe-telemetry-row">
                  <span className="globe-telemetry-label">Nearest</span>
                  <span className="globe-telemetry-value">
                    {nearestSignals.length > 0 ? `${nearestSignals[0].distanceKm.toFixed(1)} km` : 'No nearby signals'}
                  </span>
                </div>
              </div>

              {nearestSignals.length > 0 && (
                <>
                  <Divider />
                  <div className="globe-threats">
                    <div className="globe-threats-title">Nearest Signals</div>
                    {nearestSignals.map(({ signal, distanceKm }) => {
                      const withinGeofence = selectedSite.geofence_radius_km > 0 && distanceKm <= selectedSite.geofence_radius_km
                      return (
                        <div key={signal.id} className="globe-threat-row">
                          <span
                            className="globe-threat-dot"
                            style={{ background: (GLOBE_SIGNAL_COLORS[signal.signal_type] ?? Cesium.Color.WHITE).toCssHexString() }}
                          />
                          <div className="globe-threat-body">
                            <div className="globe-threat-name">
                              {GLOBE_SIGNAL_LABELS[signal.signal_type] ?? signal.signal_type}
                              {withinGeofence ? ' · Inside geofence' : ''}
                            </div>
                            <div className="globe-threat-meta bp6-text-muted">
                              {distanceKm.toFixed(1)} km · {new Date(signal.occurred_at).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {nearestResponseAssets.length > 0 && (
                <>
                  <Divider />
                  <div className="globe-threats">
                    <div className="globe-threats-title">Response Assets</div>
                    {nearestResponseAssets.map(({ asset, reading, distanceKm }) => (
                      <div key={asset.id} className="globe-threat-row">
                        <span className="globe-threat-dot" style={{ background: '#00d4ff' }} />
                        <div className="globe-threat-body">
                          <div className="globe-threat-name">
                            {asset.name} · {humanize(asset.status)}
                          </div>
                          <div className="globe-threat-meta bp6-text-muted">
                            {distanceKm.toFixed(1)} km
                            {reading ? ` · live ${formatTelemetryTimestamp(reading.ts)}` : ' · no live telemetry'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <Divider />
              <div className="globe-panel-actions">
                <Button
                  small
                  icon="map"
                  onClick={() => navigate(`/map?site_id=${selectedSite.id}`)}
                >
                  Open Tactical Map
                </Button>
              </div>
            </>
          )}

          {selectedAsset && (
            <>
              <div className="globe-panel-tags">
                <Tag minimal>{assetTypeIcon(selectedAsset.asset_type)}</Tag>
                <Tag minimal>{selectedAsset.asset_type}</Tag>
                <Tag
                  minimal
                  intent={
                    selectedAsset.status === 'available' ? 'success'
                    : selectedAsset.status === 'assigned' ? 'primary'
                    : selectedAsset.status === 'degraded' ? 'warning'
                    : 'danger'
                  }
                >
                  {humanize(selectedAsset.status)}
                </Tag>
                <Tag minimal intent={telemetryConnected ? 'success' : 'warning'}>
                  {isReplaying ? 'Replay snapshot' : telemetryConnected ? 'Telemetry live' : 'Telemetry reconnecting'}
                </Tag>
              </div>

              {selectedReading ? (
                <div className="globe-telemetry-readings">
                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">Battery</span>
                    <div className="globe-telemetry-bar-wrap">
                      <div
                        className={`globe-telemetry-bar globe-telemetry-bar--${
                          selectedReading.battery < 20 ? 'danger'
                          : selectedReading.battery < 40 ? 'warning'
                          : 'success'
                        }`}
                        style={{ width: `${selectedReading.battery}%` }}
                      />
                    </div>
                    <Tag minimal intent={batteryIntent(selectedReading.battery)}>
                      {selectedReading.battery.toFixed(0)}%
                    </Tag>
                  </div>

                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">Speed</span>
                    <span className="globe-telemetry-value">{selectedReading.speed.toFixed(1)} m/s</span>
                  </div>

                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">Heading</span>
                    <span className="globe-telemetry-value">
                      {headingLabel(selectedReading.heading)} ({selectedReading.heading}°)
                    </span>
                  </div>

                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">Position</span>
                    <span className="globe-telemetry-value">
                      {selectedReading.lat.toFixed(4)}, {selectedReading.lng.toFixed(4)}
                    </span>
                  </div>

                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">Last seen</span>
                    <span className="globe-telemetry-value bp6-text-muted">
                      {formatTelemetryTimestamp(selectedReading.ts)}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="bp6-text-muted globe-no-tasks">
                  {isReplaying ? 'Telemetry unavailable in replay mode.' : 'Awaiting telemetry data...'}
                </p>
              )}

              <Divider />
              <div className="globe-panel-actions">
                <Button
                  small
                  icon="map"
                  onClick={() => navigate(`/map?asset_id=${selectedAsset.id}`)}
                >
                  Open Tactical Map
                </Button>
              </div>
            </>
          )}

          {selectedSignal && (
            <>
              <div className="globe-panel-tags">
                <Tag
                  minimal
                  style={{
                    background: `${(GLOBE_SIGNAL_COLORS[selectedSignal.signal_type] ?? Cesium.Color.WHITE).toCssHexString()}28`,
                    color: (GLOBE_SIGNAL_COLORS[selectedSignal.signal_type] ?? Cesium.Color.WHITE).toCssHexString(),
                  }}
                >
                  {humanize(selectedSignal.signal_type)}
                </Tag>
                <Tag minimal>{SOURCE_LABELS[selectedSignal.source] ?? selectedSignal.source}</Tag>
                {selectedSignal.signal_type === 'disaster_alert' &&
                 typeof selectedSignal.raw_payload.alert_level === 'string' && (
                  <Tag minimal intent={ALERT_LEVEL_INTENT[selectedSignal.raw_payload.alert_level] ?? 'none'}>
                    {selectedSignal.raw_payload.alert_level}
                  </Tag>
                )}
                {selectedVessel?.loitering && <Tag intent="warning" minimal>Loitering</Tag>}
                {selectedVessel?.dark && <Tag intent="danger" minimal>Dark</Tag>}
              </div>

              <p className="globe-panel-coords bp6-text-muted">
                {Number(selectedSignal.lat).toFixed(4)}, {Number(selectedSignal.lng).toFixed(4)}
              </p>

              <Divider />

              <div className="globe-telemetry-readings">
                {selectedVessel?.mmsi && (
                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">MMSI</span>
                    <span className="globe-telemetry-value">{selectedVessel.mmsi}</span>
                  </div>
                )}
                {selectedVessel?.vessel_type && (
                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">Type</span>
                    <span className="globe-telemetry-value">{selectedVessel.vessel_type}</span>
                  </div>
                )}
                {selectedVessel?.flag && (
                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">Flag</span>
                    <span className="globe-telemetry-value">{selectedVessel.flag}</span>
                  </div>
                )}
                {selectedVessel?.destination && (
                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">Destination</span>
                    <span className="globe-telemetry-value">{selectedVessel.destination}</span>
                  </div>
                )}
                {selectedSignal.signal_type === 'conflict_event' && typeof selectedSignal.raw_payload.event_type === 'string' && (
                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">Event</span>
                    <span className="globe-telemetry-value">{selectedSignal.raw_payload.event_type}</span>
                  </div>
                )}
                {selectedSignal.signal_type === 'conflict_event' && typeof selectedSignal.raw_payload.country === 'string' && (
                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">Country</span>
                    <span className="globe-telemetry-value">{selectedSignal.raw_payload.country}</span>
                  </div>
                )}
                {selectedSignal.signal_type === 'disaster_alert' && typeof selectedSignal.raw_payload.event_type_name === 'string' && (
                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">Type</span>
                    <span className="globe-telemetry-value">{selectedSignal.raw_payload.event_type_name}</span>
                  </div>
                )}
                {selectedSignal.signal_type === 'disaster_alert' && typeof selectedSignal.raw_payload.country === 'string' && (
                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">Country</span>
                    <span className="globe-telemetry-value">{selectedSignal.raw_payload.country}</span>
                  </div>
                )}
                {selectedSignal.magnitude !== null && selectedSignal.magnitude !== undefined && (
                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">
                      {selectedSignal.signal_type === 'disaster_alert' ? 'Impact' : 'Magnitude'}
                    </span>
                    <span className="globe-telemetry-value">{Number(selectedSignal.magnitude).toFixed(1)}</span>
                  </div>
                )}
                {selectedSignal.altitude !== null && selectedSignal.altitude !== undefined && (
                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">Altitude</span>
                    <span className="globe-telemetry-value">{Number(selectedSignal.altitude).toFixed(0)} m</span>
                  </div>
                )}
                {selectedSignal.speed !== null && selectedSignal.speed !== undefined && (
                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">Speed</span>
                    <span className="globe-telemetry-value">{Number(selectedSignal.speed).toFixed(0)} kn</span>
                  </div>
                )}
                {selectedSignal.heading !== null && selectedSignal.heading !== undefined && (
                  <div className="globe-telemetry-row">
                    <span className="globe-telemetry-label">Heading</span>
                    <span className="globe-telemetry-value">{Number(selectedSignal.heading).toFixed(0)}°</span>
                  </div>
                )}
                <div className="globe-telemetry-row">
                  <span className="globe-telemetry-label">Occurred</span>
                  <span className="globe-telemetry-value bp6-text-muted">
                    {new Date(selectedSignal.occurred_at).toLocaleString()}
                  </span>
                </div>
              </div>

              <Divider />
              <div className="globe-panel-actions">
                <Button
                  small
                  icon="map"
                  onClick={() => navigate(`/map?signal_id=${selectedSignal.id}`)}
                >
                  Open Tactical Map
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Legend ── */}
      <div className="globe-legend bp6-dark">
        <div className="globe-legend-section-title">SITES</div>
        <div className="globe-legend-item">
          <span className="globe-legend-dot" style={{ background: '#ff4444' }} />Blocked
        </div>
        <div className="globe-legend-item">
          <span className="globe-legend-dot" style={{ background: '#32cd32' }} />Resolved
        </div>
        <div className="globe-legend-item">
          <span className="globe-legend-dot" style={{ background: '#1e90ff' }} />In progress
        </div>
        <div className="globe-legend-item">
          <span className="globe-legend-dot" style={{ background: '#00ffff' }} />Asset (live)
        </div>
        {showSignals && (
          <>
            <div className="globe-legend-section-title" style={{ marginTop: 10 }}>SIGNALS</div>
            {Object.entries(GLOBE_SIGNAL_LABELS).map(([type, label]) => (
              <div key={type} className="globe-legend-item">
                <span className="globe-legend-dot" style={{ background: GLOBE_SIGNAL_COLORS[type].toCssHexString() }} />
                {label}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
