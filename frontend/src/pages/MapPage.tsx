import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import maplibregl, { type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Button,
  Callout,
  Divider,
  InputGroup,
  Spinner,
  Tag,
  Tooltip,
} from '@blueprintjs/core'
import { useQueryClient } from '@tanstack/react-query'
import { useSites } from '../hooks/useSites'
import { useTasks, useTransitionTask, useAllowedTransitions } from '../hooks/useTasks'
import { useAssets } from '../hooks/useAssets'
import { useTelemetryStream } from '../hooks/useTelemetryStream'
import { useAreasOfOperation } from '../hooks/useAreasOfOperation'
import { useSignals } from '../hooks/useSignals'
import { useVessels, useVesselTracks } from '../hooks/useVessels'
import { useRiskScores } from '../hooks/useRiskScores'
import { useSignalRuleMatches } from '../hooks/useSignalRuleMatches'
import { useReplay } from '../context/ReplayContext'
import type { Site, Task, Asset, WorkflowStatus, Signal, RiskLevel } from '../api/types'
import type { Intent } from '@blueprintjs/core'
import { Icon } from '@blueprintjs/core'
import { SIGNAL_ICON_NAME, SIGNAL_ICON_CHAR } from '../lib/signalIcons'
import { useLocation } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Signal layer config
// ---------------------------------------------------------------------------
const SIGNAL_COLORS: Record<string, string> = {
  aircraft_position: '#00d4ff',
  vessel_position:   '#00c4a0',
  seismic_event:     '#ff8c42',
  gps_jamming:       '#ffd700',
  wildfire:          '#ff4422',
  conflict_event:    '#e040fb',
  disaster_alert:    '#ff4081',
  manual:            '#8f99a8',
}

const SIGNAL_LABELS: Record<string, string> = {
  aircraft_position: 'Aircraft',
  vessel_position:   'Vessel',
  seismic_event:     'Seismic',
  gps_jamming:       'GPS Jam',
  wildfire:          'Wildfire',
  conflict_event:    'Conflict',
  disaster_alert:    'Disaster',
  manual:            'Manual',
}

// SIGNAL_ICON_CHAR used for MapLibre HTML string contexts (popup setHTML)
// SIGNAL_ICON_NAME used in JSX contexts (<Icon> component)

const SOURCE_LABELS: Record<string, string> = {
  opensky:        'OpenSky',
  ais:            'AIS',
  usgs_seismic:   'USGS Seismic',
  gpsjam:         'GPSJam',
  firms_wildfire: 'FIRMS Wildfire',
  acled:          'ACLED',
  gdacs:          'GDACS',
  manual:         'Manual',
}

const ALERT_LEVEL_INTENT: Record<string, 'success' | 'warning' | 'danger'> = {
  Green:  'success',
  Orange: 'warning',
  Red:    'danger',
}

// ---------------------------------------------------------------------------
// Map style options
// ---------------------------------------------------------------------------
type MapStyleKey = 'tactical' | 'satellite' | 'street'

const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'esri-imagery': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '© Esri, Maxar, Earthstar Geographics',
      maxzoom: 18,
    },
    'esri-labels': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 18,
    },
  },
  layers: [
    { id: 'imagery', type: 'raster', source: 'esri-imagery' },
    { id: 'labels',  type: 'raster', source: 'esri-labels',  paint: { 'raster-opacity': 0.85 } },
  ],
}

const MAP_STYLE_CONFIGS: Record<MapStyleKey, { label: string; style: string | StyleSpecification }> = {
  tactical:  { label: 'Tactical',   style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' },
  satellite: { label: 'Satellite',  style: SATELLITE_STYLE },
  street:    { label: 'Street',     style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json' },
}

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

function priorityIntent(p: Task['priority']): Intent {
  switch (p) {
    case 'critical': return 'danger'
    case 'high':     return 'warning'
    default:         return 'none'
  }
}

function transitionLabel(s: WorkflowStatus): string {
  return s.replaceAll('_', ' ')
}

function transitionIntent(s: WorkflowStatus): Intent {
  switch (s) {
    case 'resolved':    return 'success'
    case 'blocked':     return 'danger'
    case 'in_progress': return 'primary'
    default:            return 'none'
  }
}

function siteHealthClass(tasks: Task[], siteStatus: Site['status']): string {
  if (siteStatus === 'inactive') return 'map-marker--inactive'
  if (tasks.length === 0)        return 'map-marker--active'
  const hasBlocked    = tasks.some(t => t.workflow_status === 'blocked')
  const allResolved   = tasks.every(t => t.workflow_status === 'resolved')
  const hasInProgress = tasks.some(t => t.workflow_status === 'in_progress')
  if (hasBlocked)    return 'map-marker--blocked'
  if (allResolved)   return 'map-marker--resolved'
  if (hasInProgress) return 'map-marker--in-progress'
  return 'map-marker--active'
}

function computeReadiness(tasks: Task[]): number | null {
  const total = tasks.length
  if (total === 0) return null
  const resolved   = tasks.filter(t => t.workflow_status === 'resolved').length
  const nonBlocked = tasks.filter(t => t.workflow_status !== 'blocked').length
  return (resolved / total) * 0.6 + (nonBlocked / total) * 0.4
}

const RISK_COLOR: Record<RiskLevel, string> = {
  low:      '#23a26d',
  moderate: '#f0b726',
  high:     '#e07b26',
  critical: '#cd4246',
}

const RISK_LABEL: Record<RiskLevel, string> = {
  low:      'LOW',
  moderate: 'MOD',
  high:     'HIGH',
  critical: 'CRIT',
}

function batteryIntent(pct: number): Intent {
  if (pct < 20) return 'danger'
  if (pct < 40) return 'warning'
  return 'success'
}

function assetTypeIcon(type: Asset['asset_type']): string {
  switch (type) {
    case 'vehicle':   return '🚗'
    case 'equipment': return '📡'
    case 'personnel': return '🪖'
    default:          return '●'
  }
}

function headingLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(deg / 45) % 8]
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString()
}

// ---------------------------------------------------------------------------
// TaskRow
// ---------------------------------------------------------------------------
interface TaskRowProps {
  task: Task
  disabled: boolean
  onTransitioned: () => void
}

function TaskRow({ task, disabled, onTransitioned }: TaskRowProps) {
  const transition    = useTransitionTask()
  const { data: allowedData } = useAllowedTransitions(task.id)
  const [blockReason, setBlockReason] = useState('')
  const [blocking, setBlocking]       = useState(false)
  const next = allowedData?.allowed ?? []

  function handleTransition(to: WorkflowStatus) {
    if (to === 'blocked') { setBlocking(true); return }
    transition.mutate(
      { id: task.id, body: { to_status: to } },
      { onSuccess: onTransitioned },
    )
  }

  function submitBlock() {
    transition.mutate(
      { id: task.id, body: { to_status: 'blocked', blocked_reason: blockReason || null } },
      {
        onSuccess: () => {
          setBlocking(false)
          setBlockReason('')
          onTransitioned()
        },
      },
    )
  }

  return (
    <li className="map-task-item">
      <div className="map-task-header">
        <span className="map-task-title">{task.title}</span>
        <div className="map-task-tags">
          <Tag minimal intent={workflowIntent(task.workflow_status)}>
            {task.workflow_status.replaceAll('_', ' ')}
          </Tag>
          <Tag minimal intent={priorityIntent(task.priority)}>
            {task.priority}
          </Tag>
        </div>
      </div>

      {task.workflow_status === 'blocked' && task.blocked_reason && (
        <p className="map-task-blocked-reason bp6-text-muted">{task.blocked_reason}</p>
      )}

      {blocking && (
        <div className="map-task-block-input">
          <InputGroup
            small
            placeholder="Reason for blocking (optional)"
            value={blockReason}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBlockReason(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter') submitBlock()
              if (e.key === 'Escape') { setBlocking(false); setBlockReason('') }
            }}
            autoFocus
          />
          <div className="map-task-block-actions">
            <Button small intent="danger" onClick={submitBlock} loading={transition.isPending}>
              Confirm block
            </Button>
            <Button small minimal onClick={() => { setBlocking(false); setBlockReason('') }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!blocking && next.length > 0 && !disabled && (
        <div className="map-task-actions">
          {next.map(to => (
            <Button
              key={to}
              small
              minimal
              intent={transitionIntent(to)}
              onClick={() => handleTransition(to)}
              loading={transition.isPending}
              disabled={transition.isPending}
            >
              → {transitionLabel(to)}
            </Button>
          ))}
        </div>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Geofence helpers (module-level — used in both ring effects below)
// ---------------------------------------------------------------------------

// Approximate GeoJSON circle polygon for a site geofence.
// Uses flat-earth approximation — accurate to ~1% for radii ≤ 500 km.
function geofencePolygon(lat: number, lng: number, radiusKm: number, steps = 64): GeoJSON.Feature {
  const coords: [number, number][] = []
  const latRad = (lat * Math.PI) / 180
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI
    const dLat = ((radiusKm / 6371) * Math.cos(angle) * 180) / Math.PI
    const dLng = ((radiusKm / 6371) * Math.sin(angle) * 180) / Math.PI / Math.cos(latRad)
    coords.push([lng + dLng, lat + dLat])
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  }
}

// ---------------------------------------------------------------------------
// MapPage
// ---------------------------------------------------------------------------
export default function MapPage() {
  const location              = useLocation()
  const { asOf, isReplaying } = useReplay()
  const queryClient           = useQueryClient()

  const mapContainerRef  = useRef<HTMLDivElement>(null)
  const mapRef           = useRef<maplibregl.Map | null>(null)
  const siteMarkersRef   = useRef<maplibregl.Marker[]>([])
  // asset_id → Marker (kept alive for position updates)
  const assetMarkersRef  = useRef<Map<string, maplibregl.Marker>>(new Map())
  // Ref so the signal click handler always reads fresh data without re-registering
  const signalsRef       = useRef<Signal[]>([])
  // setInterval handle for the breach ring pulse animation
  const breachPulseRef   = useRef<ReturnType<typeof setInterval> | null>(null)

  const [selectedSiteId,    setSelectedSiteId]    = useState<string | null>(null)
  const [selectedAssetId,   setSelectedAssetId]   = useState<string | null>(null)
  const [selectedSignal,    setSelectedSignal]    = useState<Signal | null>(null)
  const [selectedVesselMmsi, setSelectedVesselMmsi] = useState<string | null>(null)
  const [showSignals,       setShowSignals]        = useState(true)
  const [mapLoaded,       setMapLoaded]         = useState(false)
  const [mapStyle,        setMapStyle]          = useState<MapStyleKey>('tactical')
  const mapStyleInitRef = useRef(false)
  const urlSelectionAppliedRef = useRef(false)

  const { data: riskData } = useRiskScores()
  const riskBySiteId       = useMemo(
    () => Object.fromEntries((riskData ?? []).map(r => [String(r.site_id), r])),
    [riskData]
  )

  const asOfParam  = asOf ? { as_of: asOf } : {}
  const sitesQuery = useSites({ per_page: 200, ...asOfParam })
  const tasksQuery = useTasks({ per_page: 200, ...asOfParam })
  const assetsQuery = useAssets({ per_page: 200, ...asOfParam })
  const { data: areasRes } = useAreasOfOperation({ per_page: 200 })
  const areaOfOperations = useMemo(() => areasRes?.data ?? [], [areasRes?.data])

  // Fetch each signal type independently so no single high-volume type (aircraft)
  // can crowd out lower-volume types (vessel, wildfire, seismic) in a shared page.
  const { data: aircraftRes }  = useSignals({ signal_type: 'aircraft_position', per_page: 150 })
  const { data: vesselRes }    = useSignals({ signal_type: 'vessel_position',   per_page: 50  })
  const { data: seismicRes }   = useSignals({ signal_type: 'seismic_event',     per_page: 50  })
  const { data: gpsJamRes }    = useSignals({ signal_type: 'gps_jamming',       per_page: 50  })
  const { data: wildfireRes }  = useSignals({ signal_type: 'wildfire',          per_page: 50  })
  const { data: conflictRes }  = useSignals({ signal_type: 'conflict_event',    per_page: 50  })
  const { data: disasterRes }  = useSignals({ signal_type: 'disaster_alert',    per_page: 50  })
  const { data: manualRes }    = useSignals({ signal_type: 'manual',            per_page: 20  })
  const { data: aisGapRes }    = useSignals({ signal_type: 'ais_gap',           per_page: 20  })

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

  // Vessel lookup by MMSI (only active when a vessel_position signal is selected)
  const { data: vesselLookup } = useVessels(
    selectedVesselMmsi ? { mmsi: selectedVesselMmsi, per_page: 1 } : undefined,
    { enabled: !!selectedVesselMmsi },
  )
  const selectedVessel = vesselLookup?.data?.[0] ?? null

  // Track history for the selected vessel (rendered as a polyline on the map)
  const { data: vesselTrackRes } = useVesselTracks(selectedVessel?.id ?? null, { limit: 300 })
  const vesselTracks = useMemo(() => vesselTrackRes?.data ?? [], [vesselTrackRes?.data])

  // Active geofence breach alerts — used to highlight breached rings on the map
  const { data: breachMatchesRes } = useSignalRuleMatches({ per_page: 200 })
  const breachedSiteIds = useMemo(() => {
    const ids = new Set<string>()
    for (const m of breachMatchesRes?.data ?? []) {
      if (m.metadata?.geofence_breach === true &&
          m.workflow_status === 'unacknowledged' &&
          m.site?.id) {
        ids.add(m.site.id)
      }
    }
    return ids
  }, [breachMatchesRes?.data])

  const sites    = useMemo(() => sitesQuery.data?.data  ?? [], [sitesQuery.data?.data])
  const allTasks = useMemo(() => tasksQuery.data?.data  ?? [], [tasksQuery.data?.data])
  const assets   = useMemo(() => assetsQuery.data?.data ?? [], [assetsQuery.data?.data])
  const loading  = sitesQuery.isLoading || tasksQuery.isLoading
  const error    = sitesQuery.error?.message ?? tasksQuery.error?.message ?? null

  // Live telemetry — disabled in replay mode
  const { readings, connected: telemetryConnected } = useTelemetryStream(!isReplaying)

  const tasksBySite = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const task of allTasks) {
      if (!map[task.site_id]) map[task.site_id] = []
      map[task.site_id].push(task)
    }
    return map
  }, [allTasks])

  const selectedSite  = sites.find(s => s.id === selectedSiteId) ?? null
  const selectedTasks = selectedSiteId ? (tasksBySite[selectedSiteId] ?? []) : []
  const readiness     = computeReadiness(selectedTasks)

  const selectedAsset   = assets.find(a => a.id === selectedAssetId) ?? null
  const selectedReading = selectedAssetId ? readings.get(selectedAssetId) ?? null : null

  const handleTransitioned = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    queryClient.invalidateQueries({ queryKey: ['readiness'] })
  }, [queryClient])

  useEffect(() => {
    urlSelectionAppliedRef.current = false
  }, [location.search])

  // -------------------------------------------------------------------------
  // Map init
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style:     MAP_STYLE_CONFIGS.tactical.style as string,
      center:    [0, 20],
      zoom:      1.5,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-left')
    map.on('load', () => setMapLoaded(true))
    mapRef.current = map
    return () => { mapRef.current?.remove(); mapRef.current = null; setMapLoaded(false) }
  }, [])

  // React 18 automatically batches all setState calls within a single effect
  // into one re-render, so the four calls below produce exactly one paint.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- Reset selection state on replay timestamp change; no callback path exists for this synchronous reset */
    setSelectedSiteId(null)
    setSelectedAssetId(null)
    setSelectedSignal(null)
    setSelectedVesselMmsi(null)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [asOf])

  useEffect(() => {
    if (!mapLoaded || !mapRef.current || urlSelectionAppliedRef.current) return

    const params = new URLSearchParams(location.search)
    const siteId = params.get('site_id')
    const assetId = params.get('asset_id')
    const signalId = params.get('signal_id')

    /* eslint-disable react-hooks/set-state-in-effect -- URL handoff must synchronously hydrate map selection state before the first focused flyTo */
    if (siteId) {
      const site = sites.find(s => s.id === siteId)
      if (!site) return
      setSelectedSiteId(site.id)
      setSelectedAssetId(null)
      setSelectedSignal(null)
      setSelectedVesselMmsi(null)
      mapRef.current.flyTo({ center: [Number(site.longitude), Number(site.latitude)], zoom: 6 })
      urlSelectionAppliedRef.current = true
      return
    }

    if (assetId) {
      const asset = assets.find(a => a.id === assetId)
      if (!asset) return
      const reading = readings.get(asset.id)
      const homeSite = sites.find(s => s.id === asset.home_site_id)
      const lat = reading?.lat ?? (homeSite ? Number(homeSite.latitude) : 0)
      const lng = reading?.lng ?? (homeSite ? Number(homeSite.longitude) : 0)
      setSelectedSiteId(null)
      setSelectedAssetId(asset.id)
      setSelectedSignal(null)
      setSelectedVesselMmsi(null)
      mapRef.current.flyTo({ center: [lng, lat], zoom: 7 })
      urlSelectionAppliedRef.current = true
      return
    }

    if (signalId) {
      const signal = signals.find(s => s.id === signalId)
      if (!signal) return
      setSelectedSiteId(null)
      setSelectedAssetId(null)
      setSelectedSignal(signal)
      setSelectedVesselMmsi(signal.signal_type === 'vessel_position' ? signal.external_id : null)
      mapRef.current.flyTo({ center: [Number(signal.lng), Number(signal.lat)], zoom: 7 })
      urlSelectionAppliedRef.current = true
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [assets, location.search, mapLoaded, readings, signals, sites])

  // -------------------------------------------------------------------------
  // Style switching — skip first render (map init already loaded tactical)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!mapStyleInitRef.current) { mapStyleInitRef.current = true; return }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Must synchronously clear mapLoaded before setStyle so dependent effects don't fire against the old style
    setMapLoaded(false)
    const cfg = MAP_STYLE_CONFIGS[mapStyle]
    map.setStyle(cfg.style as StyleSpecification)
    map.once('style.load', () => setMapLoaded(true))
  }, [mapStyle])

  // -------------------------------------------------------------------------
  // Site markers — rebuild when sites / task data changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const m of siteMarkersRef.current) m.remove()
    siteMarkersRef.current = []

    for (const site of sites) {
      const tasks  = tasksBySite[site.id] ?? []
      const health = siteHealthClass(tasks, site.status)
      const el     = document.createElement('div')
      el.className = `map-marker ${health}`
      el.title     = site.name

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([Number(site.longitude), Number(site.latitude)])
        .addTo(map)

      el.addEventListener('click', () => {
        setSelectedAssetId(null)
        setSelectedSignal(null)
        setSelectedVesselMmsi(null)
        setSelectedSiteId(id => id === site.id ? null : site.id)
      })
      siteMarkersRef.current.push(marker)
    }
  }, [sites, tasksBySite])

  // -------------------------------------------------------------------------
  // AO polygon overlays — GeoJSON fill + dashed stroke
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const geojsonData: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: areaOfOperations.map(ao => ({
        type: 'Feature' as const,
        properties: { color: ao.color, name: ao.name },
        geometry: ao.geometry,
      })),
    }

    const source = map.getSource('ao-polygons') as maplibregl.GeoJSONSource | undefined
    if (source) {
      source.setData(geojsonData)
      return
    }

    map.addSource('ao-polygons', { type: 'geojson', data: geojsonData })

    // Fill layer — inserted behind site markers if that layer exists
    const beforeLayer = map.getLayer('site-markers') ? 'site-markers' : undefined
    map.addLayer(
      {
        id:     'ao-fill',
        type:   'fill',
        source: 'ao-polygons',
        paint:  { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 },
      },
      beforeLayer,
    )

    // Dashed stroke on top
    map.addLayer({
      id:     'ao-stroke',
      type:   'line',
      source: 'ao-polygons',
      paint:  {
        'line-color':     ['get', 'color'],
        'line-width':     1.5,
        'line-dasharray': [4, 2],
      },
    })
  }, [mapLoaded, areaOfOperations])

  // -------------------------------------------------------------------------
  // Geofence rings — dashed blue circle for each site's geofence_radius_km
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const geojsonData: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: sites
        .filter(s => s.geofence_radius_km > 0)
        .map(s => geofencePolygon(Number(s.latitude), Number(s.longitude), s.geofence_radius_km)),
    }

    const existing = map.getSource('geofence-rings') as maplibregl.GeoJSONSource | undefined
    if (existing) {
      existing.setData(geojsonData)
      return
    }

    map.addSource('geofence-rings', { type: 'geojson', data: geojsonData })

    // Faint fill inside the ring
    map.addLayer(
      {
        id:     'geofence-fill',
        type:   'fill',
        source: 'geofence-rings',
        paint:  { 'fill-color': '#5c7cfa', 'fill-opacity': 0.04 },
      },
      // Insert behind site markers so the ring doesn't obscure them
      map.getLayer('ao-fill') ? 'ao-fill' : undefined,
    )

    // Dashed ring outline
    map.addLayer({
      id:     'geofence-stroke',
      type:   'line',
      source: 'geofence-rings',
      paint:  {
        'line-color':     '#5c7cfa',
        'line-width':     1,
        'line-dasharray': [3, 3],
        'line-opacity':   0.6,
      },
    })
  }, [mapLoaded, sites])

  // -------------------------------------------------------------------------
  // Geofence breach rings — solid red ring for sites with active breaches
  // Data updates whenever breachedSiteIds or sites change.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const geojsonData: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: sites
        .filter(s => s.geofence_radius_km > 0 && breachedSiteIds.has(s.id))
        .map(s => geofencePolygon(Number(s.latitude), Number(s.longitude), s.geofence_radius_km)),
    }

    const existing = map.getSource('geofence-breach-rings') as maplibregl.GeoJSONSource | undefined
    if (existing) {
      existing.setData(geojsonData)
      return
    }

    map.addSource('geofence-breach-rings', { type: 'geojson', data: geojsonData })

    // Faint red fill
    map.addLayer({
      id:     'geofence-breach-fill',
      type:   'fill',
      source: 'geofence-breach-rings',
      paint:  { 'fill-color': '#fa5252', 'fill-opacity': 0.06 },
    })

    // Solid red stroke — opacity animated by the pulse effect below
    map.addLayer({
      id:     'geofence-breach-stroke',
      type:   'line',
      source: 'geofence-breach-rings',
      paint:  { 'line-color': '#fa5252', 'line-width': 2, 'line-opacity': 0.7 },
    })
  }, [mapLoaded, sites, breachedSiteIds])

  // -------------------------------------------------------------------------
  // Breach ring pulse animation — sine-wave opacity on the red stroke layer.
  // Starts when any site has an active breach, stops when none do.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapLoaded || breachedSiteIds.size === 0) {
      if (breachPulseRef.current !== null) {
        clearInterval(breachPulseRef.current)
        breachPulseRef.current = null
        // Reset opacity so the ring doesn't freeze mid-fade
        try { mapRef.current?.setPaintProperty('geofence-breach-stroke', 'line-opacity', 0.7) } catch { /* layer may not exist yet */ }
      }
      return
    }

    breachPulseRef.current = setInterval(() => {
      const map = mapRef.current
      if (!map) return
      try {
        // Oscillates between 0.15 and 0.85 at ~0.8 Hz — noticeable but not jarring
        const opacity = 0.5 + 0.35 * Math.sin((Date.now() / 630) * Math.PI)
        map.setPaintProperty('geofence-breach-stroke', 'line-opacity', opacity)
      } catch { /* layer not yet initialised */ }
    }, 50)

    return () => {
      if (breachPulseRef.current !== null) {
        clearInterval(breachPulseRef.current)
        breachPulseRef.current = null
      }
    }
  }, [mapLoaded, breachedSiteIds.size])

  // -------------------------------------------------------------------------
  // Asset markers — created once from DB positions, then moved by telemetry
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || assets.length === 0) return

    // Remove any markers for assets no longer in the list
    const currentIds = new Set(assets.map(a => a.id))
    for (const [id, marker] of assetMarkersRef.current) {
      if (!currentIds.has(id)) {
        marker.remove()
        assetMarkersRef.current.delete(id)
      }
    }

    // Create new markers for assets we haven't seen yet
    for (const asset of assets) {
      if (assetMarkersRef.current.has(asset.id)) continue

      // Seed position: home site or world centre
      const homeSite = sites.find(s => s.id === asset.home_site_id)
      const lat = homeSite ? Number(homeSite.latitude)  : 37.7749
      const lng = homeSite ? Number(homeSite.longitude) : -122.4194

      const el = document.createElement('div')
      el.className = `map-marker map-asset-marker`
      el.title     = asset.name
      el.textContent = assetTypeIcon(asset.asset_type)

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map)

      el.addEventListener('click', (e) => {
        e.stopPropagation()
        setSelectedSiteId(null)
        setSelectedSignal(null)
        setSelectedVesselMmsi(null)
        setSelectedAssetId(id => id === asset.id ? null : asset.id)
      })

      assetMarkersRef.current.set(asset.id, marker)
    }
  }, [assets, sites])

  // -------------------------------------------------------------------------
  // Update asset marker positions from live telemetry
  // -------------------------------------------------------------------------
  useEffect(() => {
    for (const [assetId, reading] of readings) {
      const marker = assetMarkersRef.current.get(assetId)
      if (marker) {
        marker.setLngLat([reading.lng, reading.lat])
      }
    }
  }, [readings])

  // -------------------------------------------------------------------------
  // Keep signalsRef current so the map click handler always reads fresh data
  // -------------------------------------------------------------------------
  useEffect(() => {
    signalsRef.current = signals
  }, [signals])

  // -------------------------------------------------------------------------
  // Signal GeoJSON layer — set up once, update data on each refresh
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: signals.map(s => ({
        type:       'Feature' as const,
        properties: {
          id:          s.id,
          signal_type: s.signal_type,
          source:      s.source,
          magnitude:   s.magnitude,
          altitude:    s.altitude,
          speed:       s.speed,
          heading:     s.heading,
          occurred_at: s.occurred_at,
          // Conflict event fields (from raw_payload)
          p_country:        (s.raw_payload.country        as string | undefined) ?? null,
          p_actor1:         (s.raw_payload.actor1         as string | undefined) ?? null,
          p_fatalities:     (s.raw_payload.fatalities     as number | undefined) ?? null,
          p_event_type:     (s.raw_payload.event_type     as string | undefined) ?? null,
          // Disaster alert fields (from raw_payload)
          p_event_type_name: (s.raw_payload.event_type_name as string | undefined) ?? null,
          p_alert_level:     (s.raw_payload.alert_level    as string | undefined) ?? null,
          p_severity_text:   (s.raw_payload.severity_text  as string | undefined) ?? null,
          p_name:            (s.raw_payload.name           as string | undefined) ?? null,
        },
        geometry: {
          type:        'Point' as const,
          coordinates: [Number(s.lng), Number(s.lat)],
        },
      })),
    }

    const existing = map.getSource('signal-points') as maplibregl.GeoJSONSource | undefined
    if (existing) {
      existing.setData(geojson)
      return
    }

    map.addSource('signal-points', { type: 'geojson', data: geojson })

    // Glow halo behind each signal point
    map.addLayer({
      id:     'signal-glow',
      type:   'circle',
      source: 'signal-points',
      paint:  {
        'circle-radius': [
          'match', ['get', 'signal_type'],
          'seismic_event', 18,
          'wildfire',      16,
          12,
        ],
        'circle-color': [
          'match', ['get', 'signal_type'],
          'aircraft_position', SIGNAL_COLORS.aircraft_position,
          'vessel_position',   SIGNAL_COLORS.vessel_position,
          'seismic_event',     SIGNAL_COLORS.seismic_event,
          'gps_jamming',       SIGNAL_COLORS.gps_jamming,
          'wildfire',          SIGNAL_COLORS.wildfire,
          'conflict_event',    SIGNAL_COLORS.conflict_event,
          'disaster_alert',    SIGNAL_COLORS.disaster_alert,
          SIGNAL_COLORS.manual,
        ],
        'circle-opacity': 0.15,
        'circle-blur':    1.2,
      },
    })

    map.addLayer({
      id:     'signal-circles',
      type:   'circle',
      source: 'signal-points',
      paint:  {
        'circle-radius': [
          'match', ['get', 'signal_type'],
          'seismic_event', 8,
          'wildfire',      7,
          5,
        ],
        'circle-color': [
          'match', ['get', 'signal_type'],
          'aircraft_position', SIGNAL_COLORS.aircraft_position,
          'vessel_position',   SIGNAL_COLORS.vessel_position,
          'seismic_event',     SIGNAL_COLORS.seismic_event,
          'gps_jamming',       SIGNAL_COLORS.gps_jamming,
          'wildfire',          SIGNAL_COLORS.wildfire,
          'conflict_event',    SIGNAL_COLORS.conflict_event,
          'disaster_alert',    SIGNAL_COLORS.disaster_alert,
          SIGNAL_COLORS.manual,
        ],
        'circle-opacity':       0.85,
        'circle-stroke-width':  1,
        'circle-stroke-color':  'rgba(255,255,255,0.25)',
      },
    })

    // Symbol layer — unicode char centered on each signal dot
    map.addLayer({
      id:     'signal-symbols',
      type:   'symbol',
      source: 'signal-points',
      layout: {
        'text-field': ['match', ['get', 'signal_type'],
          'aircraft_position', '✈',
          'vessel_position',   '⚓',
          'seismic_event',     '≈',
          'gps_jamming',       '⊗',
          'wildfire',          '△',
          'ais_gap',           '⊙',
          'manual',            '+',
          '●',
        ],
        'text-size':             11,
        'text-anchor':           'center',
        'text-allow-overlap':    true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color':       '#ffffff',
        'text-halo-color':  'rgba(0,0,0,0.45)',
        'text-halo-width':  1,
      },
    })

    const handleSignalClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return
      const props = e.features[0].properties
      const sig   = signalsRef.current.find(s => s.id === props.id)
      if (!sig) return
      setSelectedSiteId(null)
      setSelectedAssetId(null)
      const isSameSignal = (prev: Signal | null) => prev?.id === sig.id
      setSelectedSignal(prev => isSameSignal(prev) ? null : sig)
      // For vessel signals, set the MMSI so the track polyline query activates
      if (sig.signal_type === 'vessel_position') {
        setSelectedVesselMmsi(prev => prev === sig.external_id ? null : sig.external_id)
      } else {
        setSelectedVesselMmsi(null)
      }
    }

    map.on('click', 'signal-circles', handleSignalClick)
    map.on('click', 'signal-symbols', handleSignalClick)

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 8,
      className: 'signal-popup-container',
    })

    const handleMouseEnter = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      map.getCanvas().style.cursor = 'pointer'
      if (!e.features?.length) return
      const props = e.features[0].properties as Record<string, string>
      const coords = (e.features[0].geometry as unknown as { coordinates: [number, number] }).coordinates
      const label  = SIGNAL_LABELS[props.signal_type] ?? props.signal_type
      const icon   = SIGNAL_ICON_CHAR[props.signal_type] ?? '●'
      const color  = SIGNAL_COLORS[props.signal_type] ?? '#8f99a8'
      const time   = props.occurred_at ? new Date(props.occurred_at).toLocaleTimeString() : ''

      // Build contextual detail rows based on signal type
      let detailRows = ''
      if (props.signal_type === 'conflict_event') {
        const country    = props.p_country   ? `<span class="sp-row"><span>Country</span><b>${props.p_country}</b></span>` : ''
        const actor      = props.p_actor1    ? `<span class="sp-row"><span>Actor</span><b>${props.p_actor1}</b></span>` : ''
        const fatalities = props.p_fatalities != null
          ? `<span class="sp-row"><span>Fatalities</span><b>${props.p_fatalities}</b></span>` : ''
        detailRows = country + actor + fatalities
      } else if (props.signal_type === 'disaster_alert') {
        const typeRow    = props.p_event_type_name ? `<span class="sp-row"><span>Type</span><b>${props.p_event_type_name}</b></span>` : ''
        const country    = props.p_country    ? `<span class="sp-row"><span>Country</span><b>${props.p_country}</b></span>` : ''
        const alertColor = props.p_alert_level === 'Red' ? '#ff4444' : props.p_alert_level === 'Orange' ? '#ff9800' : '#4caf50'
        const alertRow   = props.p_alert_level
          ? `<span class="sp-row"><span>Alert</span><b style="color:${alertColor}">${props.p_alert_level}</b></span>` : ''
        const sevRow     = props.p_severity_text ? `<span class="sp-row"><span>Severity</span><b>${props.p_severity_text}</b></span>` : ''
        detailRows = typeRow + country + alertRow + sevRow
      } else {
        const mag = props.magnitude ? `<span class="sp-row"><span>Magnitude</span><b>${Number(props.magnitude).toFixed(1)}</b></span>` : ''
        const alt = props.altitude  ? `<span class="sp-row"><span>Altitude</span><b>${Number(props.altitude).toFixed(0)} m</b></span>` : ''
        const spd = props.speed     ? `<span class="sp-row"><span>Speed</span><b>${Number(props.speed).toFixed(0)} kn</b></span>` : ''
        detailRows = mag + alt + spd
      }

      popup
        .setLngLat(coords)
        .setHTML(`
          <div class="signal-popup">
            <div class="sp-header" style="border-left: 3px solid ${color}">
              <span class="sp-icon">${icon}</span>
              <span class="sp-type">${props.signal_type === 'disaster_alert' && props.p_name ? props.p_name : label}</span>
            </div>
            <div class="sp-body">
              <span class="sp-row"><span>Source</span><b>${SOURCE_LABELS[props.source] ?? props.source}</b></span>
              ${detailRows}
              ${time ? `<span class="sp-row"><span>Time</span><b>${time}</b></span>` : ''}
              <span class="sp-hint">Click for details</span>
            </div>
          </div>`)
        .addTo(map)
    }

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
      popup.remove()
    }

    map.on('mouseenter', 'signal-circles', handleMouseEnter)
    map.on('mouseenter', 'signal-symbols', handleMouseEnter)
    map.on('mouseleave', 'signal-circles', handleMouseLeave)
    map.on('mouseleave', 'signal-symbols', handleMouseLeave)
  }, [mapLoaded, signals])

  // -------------------------------------------------------------------------
  // Vessel track polyline — drawn/cleared when vesselTracks changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    // Always remove stale layer/source first
    if (map.getLayer('vessel-track-line')) map.removeLayer('vessel-track-line')
    if (map.getSource('vessel-track'))     map.removeSource('vessel-track')

    if (vesselTracks.length < 2) return

    const coords = vesselTracks.map(t => [Number(t.lng), Number(t.lat)])

    map.addSource('vessel-track', {
      type: 'geojson',
      data: {
        type:       'Feature',
        properties: {},
        geometry:   { type: 'LineString', coordinates: coords },
      },
    })

    // Insert behind signal dots so the track doesn't obscure other signals
    map.addLayer({
      id:     'vessel-track-line',
      type:   'line',
      source: 'vessel-track',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint:  {
        'line-color':     SIGNAL_COLORS.vessel_position,
        'line-width':     2.5,
        'line-opacity':   0.80,
        'line-dasharray': [4, 3],
      },
    }, 'signal-glow')
  }, [mapLoaded, vesselTracks])

  // -------------------------------------------------------------------------
  // Toggle signal layer visibility
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !map.getLayer('signal-circles')) return
    map.setLayoutProperty('signal-circles', 'visibility', showSignals ? 'visible' : 'none')
    if (map.getLayer('signal-glow')) {
      map.setLayoutProperty('signal-glow', 'visibility', showSignals ? 'visible' : 'none')
    }
    if (map.getLayer('signal-symbols')) {
      map.setLayoutProperty('signal-symbols', 'visibility', showSignals ? 'visible' : 'none')
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronously clear signal selection when signals are hidden
    if (!showSignals) { setSelectedSignal(null); setSelectedVesselMmsi(null) }
  }, [showSignals, mapLoaded])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="map-page">
      <div ref={mapContainerRef} className="map-container" />

      {loading && (
        <div className="map-overlay map-overlay--loading"><Spinner /></div>
      )}

      {error && (
        <div className="map-overlay map-overlay--error">
          <Callout intent="danger" title="Failed to load map data" compact>{error}</Callout>
        </div>
      )}

      {/* Telemetry connectivity badge */}
      {!isReplaying && (
        <div className={`map-telemetry-badge map-telemetry-badge--${telemetryConnected ? 'live' : 'offline'}`}>
          <span className="map-telemetry-dot" />
          {telemetryConnected ? 'TELEMETRY LIVE' : 'TELEMETRY OFFLINE'}
        </div>
      )}

      {/* Map style switcher */}
      <div className="map-style-switcher">
        {(Object.keys(MAP_STYLE_CONFIGS) as MapStyleKey[]).map(key => (
          <button
            key={key}
            className={`map-style-btn${mapStyle === key ? ' map-style-btn--active' : ''}`}
            onClick={() => setMapStyle(key)}
          >
            {MAP_STYLE_CONFIGS[key].label}
          </button>
        ))}
      </div>

      {/* Signal layer toggle */}
      {showSignals && (
        <div className="map-signal-legend">
          {Object.entries(SIGNAL_LABELS).map(([type, label]) => (
            <div key={type} className="map-signal-legend-item">
              <span className="map-signal-legend-dot" style={{ background: SIGNAL_COLORS[type] }} />
              {label}
            </div>
          ))}
        </div>
      )}
      <div
        className={`map-signal-toggle${showSignals ? ' map-signal-toggle--active' : ''}`}
        onClick={() => setShowSignals(v => !v)}
        role="button"
        aria-label="Toggle signal layer"
      >
        <span className="map-signal-toggle-dot" />
        SIGNALS {showSignals ? 'ON' : 'OFF'}
      </div>

      {/* ── Site panel ── */}
      {selectedSite && (
        <div className="map-panel bp6-dark">
          <div className="map-panel-header">
            <span className="map-panel-title">{selectedSite.name}</span>
            <button
              className="map-panel-close bp6-button bp6-minimal bp6-icon-cross"
              onClick={() => setSelectedSiteId(null)}
              aria-label="Close"
            />
          </div>

          <div className="map-panel-tags">
            <Tag minimal intent={selectedSite.status === 'active' ? 'success' : 'none'}>
              {selectedSite.status}
            </Tag>
            <Tag minimal>{selectedTasks.length} task{selectedTasks.length !== 1 ? 's' : ''}</Tag>
            {readiness !== null && (
              <Tag
                minimal
                intent={readiness >= 0.8 ? 'success' : readiness >= 0.5 ? 'warning' : 'danger'}
              >
                {Math.round(readiness * 100)}% ready
              </Tag>
            )}
            {riskBySiteId[String(selectedSite.id)] && (() => {
              const risk = riskBySiteId[String(selectedSite.id)]
              return (
                <Tooltip
                  content={
                    <span style={{ fontSize: 11, lineHeight: 1.7 }}>
                      <strong>Risk Score: {risk.score}/100</strong><br />
                      Alerts: {risk.components.alert_pressure.toFixed(1)}&nbsp;·&nbsp;
                      Tasks: {risk.components.task_health.toFixed(1)}&nbsp;·&nbsp;
                      Signals: {risk.components.signal_density.toFixed(1)}
                    </span>
                  }
                  placement="top"
                >
                  <Tag
                    minimal
                    style={{
                      fontWeight: 700,
                      color: RISK_COLOR[risk.risk_level],
                      borderColor: RISK_COLOR[risk.risk_level],
                      cursor: 'default',
                      letterSpacing: '0.04em',
                    }}
                  >
                    RISK {RISK_LABEL[risk.risk_level]} {risk.score}
                  </Tag>
                </Tooltip>
              )
            })()}
          </div>

          <p className="map-panel-coords bp6-text-muted">
            {Number(selectedSite.latitude).toFixed(4)}, {Number(selectedSite.longitude).toFixed(4)}
          </p>

          {isReplaying && (
            <Callout intent="warning" compact className="map-replay-notice">
              Replay mode — transitions disabled
            </Callout>
          )}

          {selectedTasks.length > 0 && (
            <>
              <Divider />
              <ul className="map-task-list">
                {selectedTasks.map(task => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    disabled={isReplaying}
                    onTransitioned={handleTransitioned}
                  />
                ))}
              </ul>
            </>
          )}

          {selectedTasks.length === 0 && (
            <p className="bp6-text-muted map-no-tasks">No tasks assigned to this site.</p>
          )}
        </div>
      )}

      {/* ── Asset telemetry panel ── */}
      {selectedAsset && (
        <div className="map-panel map-panel--asset bp6-dark">
          <div className="map-panel-header">
            <span className="map-panel-title">
              {assetTypeIcon(selectedAsset.asset_type)} {selectedAsset.name}
            </span>
            <button
              className="map-panel-close bp6-button bp6-minimal bp6-icon-cross"
              onClick={() => setSelectedAssetId(null)}
              aria-label="Close"
            />
          </div>

          <div className="map-panel-tags">
            <Tag minimal>{selectedAsset.asset_type}</Tag>
            <Tag
              minimal
              intent={
                selectedAsset.status === 'available' ? 'success'
                : selectedAsset.status === 'in_use' ? 'primary'
                : selectedAsset.status === 'maintenance' ? 'warning'
                : 'danger'
              }
            >
              {selectedAsset.status.replace('_', ' ')}
            </Tag>
          </div>

          <Divider />

          {selectedReading ? (
            <div className="map-telemetry-readings">
              <div className="map-telemetry-row">
                <span className="map-telemetry-label">Battery</span>
                <div className="map-telemetry-bar-wrap">
                  <div
                    className={`map-telemetry-bar map-telemetry-bar--${
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

              <div className="map-telemetry-row">
                <span className="map-telemetry-label">Speed</span>
                <span className="map-telemetry-value">
                  {selectedReading.speed.toFixed(1)} m/s
                </span>
              </div>

              <div className="map-telemetry-row">
                <span className="map-telemetry-label">Heading</span>
                <span className="map-telemetry-value">
                  {headingLabel(selectedReading.heading)} ({selectedReading.heading}°)
                </span>
              </div>

              <div className="map-telemetry-row">
                <span className="map-telemetry-label">Position</span>
                <span className="map-telemetry-value">
                  {selectedReading.lat.toFixed(4)}, {selectedReading.lng.toFixed(4)}
                </span>
              </div>

              <div className="map-telemetry-row">
                <span className="map-telemetry-label">Last seen</span>
                <span className="map-telemetry-value bp6-text-muted">
                  {formatTimestamp(selectedReading.ts)}
                </span>
              </div>
            </div>
          ) : (
            <p className="bp6-text-muted map-no-tasks">
              {isReplaying ? 'Telemetry unavailable in replay mode.' : 'Awaiting telemetry data…'}
            </p>
          )}
        </div>
      )}
      {/* ── Signal info panel ── */}
      {selectedSignal && (
        <div className="map-panel bp6-dark">
          <div className="map-panel-header">
            <span className="map-panel-title">
              <Icon icon={SIGNAL_ICON_NAME[selectedSignal.signal_type] ?? 'dot'} size={14} style={{ marginRight: 6 }} />
              {selectedVessel?.name
                ? selectedVessel.name
                : selectedSignal.signal_type === 'disaster_alert' && typeof selectedSignal.raw_payload.name === 'string'
                  ? selectedSignal.raw_payload.name
                  : selectedSignal.signal_type === 'conflict_event' && typeof selectedSignal.raw_payload.sub_event_type === 'string'
                    ? selectedSignal.raw_payload.sub_event_type
                    : (SIGNAL_LABELS[selectedSignal.signal_type] ?? selectedSignal.signal_type)}
            </span>
            <button
              className="map-panel-close bp6-button bp6-minimal bp6-icon-cross"
              onClick={() => { setSelectedSignal(null); setSelectedVesselMmsi(null) }}
              aria-label="Close"
            />
          </div>

          <div className="map-panel-tags">
            <Tag
              minimal
              style={{
                background: SIGNAL_COLORS[selectedSignal.signal_type] + '28',
                color:      SIGNAL_COLORS[selectedSignal.signal_type],
              }}
            >
              {selectedSignal.signal_type.replace(/_/g, ' ')}
            </Tag>
            <Tag minimal>{SOURCE_LABELS[selectedSignal.source] ?? selectedSignal.source}</Tag>
            {selectedSignal.signal_type === 'disaster_alert' &&
             typeof selectedSignal.raw_payload.alert_level === 'string' && (
              <Tag
                intent={ALERT_LEVEL_INTENT[selectedSignal.raw_payload.alert_level] ?? 'none'}
                minimal
              >
                {selectedSignal.raw_payload.alert_level}
              </Tag>
            )}
            {selectedVessel?.loitering && (
              <Tag intent="warning" minimal>Loitering</Tag>
            )}
            {selectedVessel?.dark && (
              <Tag intent="danger" minimal>Dark</Tag>
            )}
          </div>

          <p className="map-panel-coords bp6-text-muted">
            {Number(selectedSignal.lat).toFixed(4)}, {Number(selectedSignal.lng).toFixed(4)}
          </p>

          <Divider />

          <div className="map-telemetry-readings">
            {/* Vessel-specific identity fields */}
            {selectedVessel && (
              <>
                {selectedVessel.mmsi && (
                  <div className="map-telemetry-row">
                    <span className="map-telemetry-label">MMSI</span>
                    <span className="map-telemetry-value">{selectedVessel.mmsi}</span>
                  </div>
                )}
                {selectedVessel.vessel_type && (
                  <div className="map-telemetry-row">
                    <span className="map-telemetry-label">Type</span>
                    <span className="map-telemetry-value">{selectedVessel.vessel_type}</span>
                  </div>
                )}
                {selectedVessel.flag && (
                  <div className="map-telemetry-row">
                    <span className="map-telemetry-label">Flag</span>
                    <span className="map-telemetry-value">{selectedVessel.flag}</span>
                  </div>
                )}
                {selectedVessel.destination && (
                  <div className="map-telemetry-row">
                    <span className="map-telemetry-label">Destination</span>
                    <span className="map-telemetry-value">{selectedVessel.destination}</span>
                  </div>
                )}
                {vesselTracks.length > 1 && (
                  <div className="map-telemetry-row">
                    <span className="map-telemetry-label">Track</span>
                    <span className="map-telemetry-value bp6-text-muted">
                      {vesselTracks.length} pts · {new Date(vesselTracks[0].occurred_at).toLocaleDateString()}
                      {' – '}
                      {new Date(vesselTracks[vesselTracks.length - 1].occurred_at).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </>
            )}

            {/* Conflict event detail */}
            {selectedSignal.signal_type === 'conflict_event' && (() => {
              const p = selectedSignal.raw_payload
              const eventType   = typeof p.event_type   === 'string' ? p.event_type   : null
              const country     = typeof p.country      === 'string' ? p.country      : null
              const actor1      = typeof p.actor1       === 'string' ? p.actor1       : null
              const actor2      = typeof p.actor2       === 'string' && p.actor2.length > 0 ? p.actor2 : null
              const fatalities  = typeof p.fatalities   === 'number' ? p.fatalities   : 0
              const notes       = typeof p.notes        === 'string' ? p.notes        : null
              return (
                <>
                  {eventType && (
                    <div className="map-telemetry-row">
                      <span className="map-telemetry-label">Event</span>
                      <span className="map-telemetry-value">{eventType}</span>
                    </div>
                  )}
                  {country && (
                    <div className="map-telemetry-row">
                      <span className="map-telemetry-label">Country</span>
                      <span className="map-telemetry-value">{country}</span>
                    </div>
                  )}
                  {actor1 && (
                    <div className="map-telemetry-row">
                      <span className="map-telemetry-label">Actor</span>
                      <span className="map-telemetry-value">{actor1}</span>
                    </div>
                  )}
                  {actor2 && (
                    <div className="map-telemetry-row">
                      <span className="map-telemetry-label">vs</span>
                      <span className="map-telemetry-value">{actor2}</span>
                    </div>
                  )}
                  <div className="map-telemetry-row">
                    <span className="map-telemetry-label">Fatalities</span>
                    <span className="map-telemetry-value" style={fatalities > 0 ? { color: '#ff6b6b', fontWeight: 600 } : undefined}>
                      {fatalities}
                    </span>
                  </div>
                  {notes && (
                    <div className="map-telemetry-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                      <span className="map-telemetry-label">Notes</span>
                      <span className="map-telemetry-value bp6-text-muted" style={{ fontStyle: 'italic', fontSize: 11, whiteSpace: 'normal' }}>
                        {notes}
                      </span>
                    </div>
                  )}
                </>
              )
            })()}

            {/* Disaster alert detail */}
            {selectedSignal.signal_type === 'disaster_alert' && (() => {
              const p            = selectedSignal.raw_payload
              const typeName     = typeof p.event_type_name === 'string' ? p.event_type_name : null
              const country      = typeof p.country         === 'string' ? p.country         : null
              const severityText = typeof p.severity_text   === 'string' ? p.severity_text   : null
              return (
                <>
                  {typeName && (
                    <div className="map-telemetry-row">
                      <span className="map-telemetry-label">Type</span>
                      <span className="map-telemetry-value">{typeName}</span>
                    </div>
                  )}
                  {country && (
                    <div className="map-telemetry-row">
                      <span className="map-telemetry-label">Country</span>
                      <span className="map-telemetry-value">{country}</span>
                    </div>
                  )}
                  {severityText && (
                    <div className="map-telemetry-row">
                      <span className="map-telemetry-label">Severity</span>
                      <span className="map-telemetry-value">{severityText}</span>
                    </div>
                  )}
                  {selectedSignal.magnitude != null && (
                    <div className="map-telemetry-row">
                      <span className="map-telemetry-label">Impact score</span>
                      <span className="map-telemetry-value">
                        {Number(selectedSignal.magnitude).toFixed(1)} / 3.0
                      </span>
                    </div>
                  )}
                </>
              )
            })()}

            {/* Standard signal telemetry — suppressed for types with custom display above */}
            {selectedSignal.magnitude !== null && selectedSignal.magnitude !== undefined &&
             selectedSignal.signal_type !== 'conflict_event' &&
             selectedSignal.signal_type !== 'disaster_alert' && (
              <div className="map-telemetry-row">
                <span className="map-telemetry-label">Magnitude</span>
                <span className="map-telemetry-value">
                  {Number(selectedSignal.magnitude).toFixed(1)}
                </span>
              </div>
            )}
            {selectedSignal.altitude !== null && selectedSignal.altitude !== undefined && (
              <div className="map-telemetry-row">
                <span className="map-telemetry-label">Altitude</span>
                <span className="map-telemetry-value">
                  {Number(selectedSignal.altitude).toFixed(0)} m
                </span>
              </div>
            )}
            {selectedSignal.speed !== null && selectedSignal.speed !== undefined && (
              <div className="map-telemetry-row">
                <span className="map-telemetry-label">Speed</span>
                <span className="map-telemetry-value">
                  {Number(selectedSignal.speed).toFixed(0)} kn
                </span>
              </div>
            )}
            {selectedSignal.heading !== null && selectedSignal.heading !== undefined && (
              <div className="map-telemetry-row">
                <span className="map-telemetry-label">Heading</span>
                <span className="map-telemetry-value">
                  {Number(selectedSignal.heading).toFixed(0)}°
                </span>
              </div>
            )}
            <div className="map-telemetry-row">
              <span className="map-telemetry-label">Occurred</span>
              <span className="map-telemetry-value bp6-text-muted">
                {new Date(selectedSignal.occurred_at).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
