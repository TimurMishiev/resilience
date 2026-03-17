import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Button,
  Callout,
  Divider,
  InputGroup,
  Spinner,
  Tag,
} from '@blueprintjs/core'
import { useQueryClient } from '@tanstack/react-query'
import { useSites } from '../hooks/useSites'
import { useTasks, useTransitionTask } from '../hooks/useTasks'
import { useAssets } from '../hooks/useAssets'
import { useTelemetryStream } from '../hooks/useTelemetryStream'
import { useAreasOfOperation } from '../hooks/useAreasOfOperation'
import { useSignals } from '../hooks/useSignals'
import { useReplay } from '../context/ReplayContext'
import type { Site, Task, Asset, WorkflowStatus, Signal } from '../api/types'
import type { Intent } from '@blueprintjs/core'

// ---------------------------------------------------------------------------
// Signal layer config
// ---------------------------------------------------------------------------
const SIGNAL_COLORS: Record<string, string> = {
  aircraft_position: '#00d4ff',
  vessel_position:   '#00c4a0',
  seismic_event:     '#ff8c42',
  gps_jamming:       '#ffd700',
  wildfire:          '#ff4422',
  manual:            '#8f99a8',
}

const SIGNAL_LABELS: Record<string, string> = {
  aircraft_position: 'Aircraft',
  vessel_position:   'Vessel',
  seismic_event:     'Seismic',
  gps_jamming:       'GPS Jam',
  wildfire:          'Wildfire',
  manual:            'Manual',
}

const SIGNAL_ICONS: Record<string, string> = {
  aircraft_position: '✈',
  vessel_position:   '⛴',
  seismic_event:     '⚡',
  gps_jamming:       '⚠',
  wildfire:          '🔥',
  manual:            '●',
}

const SOURCE_LABELS: Record<string, string> = {
  opensky:        'OpenSky',
  ais:            'AIS',
  usgs_seismic:   'USGS Seismic',
  gpsjam:         'GPSJam',
  firms_wildfire: 'FIRMS Wildfire',
  manual:         'Manual',
}

// ---------------------------------------------------------------------------
// Transition table — mirrors backend ALLOWED_TRANSITIONS
// ---------------------------------------------------------------------------
const ALLOWED: Record<WorkflowStatus, WorkflowStatus[]> = {
  new:         ['triaged'],
  triaged:     ['in_progress'],
  in_progress: ['blocked', 'resolved'],
  blocked:     ['in_progress'],
  resolved:    ['triaged'],
}

function allowedTransitions(status: WorkflowStatus): WorkflowStatus[] {
  return ALLOWED[status] ?? []
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
  return s.replace('_', ' ')
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
  const transition = useTransitionTask()
  const [blockReason, setBlockReason] = useState('')
  const [blocking, setBlocking]       = useState(false)
  const next = allowedTransitions(task.workflow_status)

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
            {task.workflow_status.replace('_', ' ')}
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
// MapPage
// ---------------------------------------------------------------------------
export default function MapPage() {
  const { asOf, isReplaying } = useReplay()
  const queryClient           = useQueryClient()

  const mapContainerRef  = useRef<HTMLDivElement>(null)
  const mapRef           = useRef<maplibregl.Map | null>(null)
  const siteMarkersRef   = useRef<maplibregl.Marker[]>([])
  // asset_id → Marker (kept alive for position updates)
  const assetMarkersRef  = useRef<Map<string, maplibregl.Marker>>(new Map())
  // Ref so the signal click handler always reads fresh data without re-registering
  const signalsRef       = useRef<Signal[]>([])

  const [selectedSiteId,  setSelectedSiteId]   = useState<string | null>(null)
  const [selectedAssetId, setSelectedAssetId]  = useState<string | null>(null)
  const [selectedSignal,  setSelectedSignal]   = useState<Signal | null>(null)
  const [showSignals,     setShowSignals]       = useState(true)
  const [mapLoaded,       setMapLoaded]         = useState(false)

  const asOfParam  = asOf ? { as_of: asOf } : {}
  const sitesQuery = useSites({ per_page: 200, ...asOfParam })
  const tasksQuery = useTasks({ per_page: 200, ...asOfParam })
  const assetsQuery = useAssets({ per_page: 200, ...asOfParam })
  const { data: areasRes } = useAreasOfOperation({ per_page: 200 })
  const areaOfOperations = useMemo(() => areasRes?.data ?? [], [areasRes?.data])

  const { data: signalsRes } = useSignals({ per_page: 200 })
  const signals = useMemo(() => signalsRes?.data ?? [], [signalsRes?.data])

  const sites    = useMemo(() => sitesQuery.data?.data  ?? [], [sitesQuery.data?.data])
  const allTasks = useMemo(() => tasksQuery.data?.data  ?? [], [tasksQuery.data?.data])
  const assets   = useMemo(() => assetsQuery.data?.data ?? [], [assetsQuery.data?.data])
  const loading  = sitesQuery.isLoading || tasksQuery.isLoading
  const error    = sitesQuery.error?.message ?? tasksQuery.error?.message ?? null

  // Live telemetry — disabled in replay mode
  const { readings, connected: telemetryConnected } = useTelemetryStream(!isReplaying)

  const tasksBySite: Record<string, Task[]> = {}
  for (const task of allTasks) {
    if (!tasksBySite[task.site_id]) tasksBySite[task.site_id] = []
    tasksBySite[task.site_id].push(task)
  }

  const selectedSite  = sites.find(s => s.id === selectedSiteId) ?? null
  const selectedTasks = selectedSiteId ? (tasksBySite[selectedSiteId] ?? []) : []
  const readiness     = computeReadiness(selectedTasks)

  const selectedAsset   = assets.find(a => a.id === selectedAssetId) ?? null
  const selectedReading = selectedAssetId ? readings.get(selectedAssetId) ?? null : null

  const handleTransitioned = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    queryClient.invalidateQueries({ queryKey: ['readiness'] })
  }, [queryClient])

  // -------------------------------------------------------------------------
  // Map init
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style:     'https://demotiles.maplibre.org/style.json',
      center:    [0, 20],
      zoom:      1.5,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-left')
    map.on('load', () => setMapLoaded(true))
    mapRef.current = map
    return () => { mapRef.current?.remove(); mapRef.current = null; setMapLoaded(false) }
  }, [])

  useEffect(() => { setSelectedSiteId(null); setSelectedAssetId(null) }, [asOf])

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
        setSelectedSiteId(id => id === site.id ? null : site.id)
      })
      siteMarkersRef.current.push(marker)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, allTasks])

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
          SIGNAL_COLORS.manual,
        ],
        'circle-opacity':       0.85,
        'circle-stroke-width':  1,
        'circle-stroke-color':  'rgba(255,255,255,0.25)',
      },
    })

    map.on('click', 'signal-circles', e => {
      if (!e.features?.length) return
      const props = e.features[0].properties
      const sig   = signalsRef.current.find(s => s.id === props.id)
      if (!sig) return
      setSelectedSiteId(null)
      setSelectedAssetId(null)
      setSelectedSignal(prev => prev?.id === sig.id ? null : sig)
    })

    map.on('mouseenter', 'signal-circles', () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', 'signal-circles', () => {
      map.getCanvas().style.cursor = ''
    })
  }, [mapLoaded, signals])

  // -------------------------------------------------------------------------
  // Toggle signal layer visibility
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !map.getLayer('signal-circles')) return
    map.setLayoutProperty('signal-circles', 'visibility', showSignals ? 'visible' : 'none')
    if (!showSignals) setSelectedSignal(null)
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
              {SIGNAL_ICONS[selectedSignal.signal_type]}{' '}
              {SIGNAL_LABELS[selectedSignal.signal_type] ?? selectedSignal.signal_type}
            </span>
            <button
              className="map-panel-close bp6-button bp6-minimal bp6-icon-cross"
              onClick={() => setSelectedSignal(null)}
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
          </div>

          <p className="map-panel-coords bp6-text-muted">
            {Number(selectedSignal.lat).toFixed(4)}, {Number(selectedSignal.lng).toFixed(4)}
          </p>

          <Divider />

          <div className="map-telemetry-readings">
            {selectedSignal.magnitude !== null && selectedSignal.magnitude !== undefined && (
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
