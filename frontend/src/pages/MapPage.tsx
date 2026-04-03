import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  Callout,
  Spinner,
} from '@blueprintjs/core'
import { useQueryClient } from '@tanstack/react-query'
import { useSites } from '../hooks/useSites'
import { useTasks } from '../hooks/useTasks'
import { useAssets } from '../hooks/useAssets'
import { useTelemetry } from '../hooks/useTelemetry'
import { useAreasOfOperation } from '../hooks/useAreasOfOperation'
import { useSignalsLive } from '../hooks/useSignals'
import { useVessels, useVesselTracks } from '../hooks/useVessels'
import { useRiskScores } from '../hooks/useRiskScores'
import { useActiveBreachSiteIds } from '../hooks/useSignalRuleMatches'
import { useChokepoints } from '../hooks/useChokepoints'
import { useRole } from '../hooks/useRole'
import { useReplayParams } from '../hooks/useReplayParams'
import { useAssetTrails } from '../hooks/useAssetTrails'
import { useEntitySelectionSync } from '../hooks/useEntitySelectionSync'
import { useMapLibreEngine, MAP_STYLE_CONFIGS, type MapStyleKey } from '../hooks/useMapLibreEngine'
import type { Task } from '../api/types'
import { useLocation } from 'react-router-dom'
import { assetDisplayPosition, getLiveTelemetryReading } from '../lib/assetPresentation'
import { buildCoverageCircles } from '../lib/coverage'
import { parseEntitySelectionRoute } from '../lib/entitySelectionRoute'
import { computeReadiness } from '../lib/formatters'
import { SIGNAL_COLORS, SIGNAL_LABELS } from '../lib/signalConfig'
import { MapSitePanel } from '../components/MapSitePanel'
import { MapAssetPanel } from '../components/MapAssetPanel'
import { MapSignalPanel } from '../components/MapSignalPanel'

const E2E_PICK_SEARCH_OFFSETS: Array<{ x: number; y: number }> = (() => {
  const offsets = [{ x: 0, y: 0 }]
  for (let radius = 2; radius <= 30; radius += 2) {
    for (let y = -radius; y <= radius; y += 2) {
      for (let x = -radius; x <= radius; x += 2) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== radius) continue
        offsets.push({ x, y })
      }
    }
  }
  return offsets
})()

type MapE2ESelectionTarget = {
  id: string
  name: string
}

type MapE2ECanvasPoint = {
  x: number
  y: number
}

type MapE2EApi = {
  getState: () => {
    mapLoaded: boolean
    zoom: number | null
    telemetryConnected: boolean
    signalsConnected: boolean
    signalCount: number
    selectedSiteId: string | null
    selectedAssetId: string | null
    selectedSignalId: string | null
  }
  getFirstSiteTarget: () => MapE2ESelectionTarget | null
  projectPosition: (lng: number, lat: number) => MapE2ECanvasPoint | null
  getPickableSiteCanvasTarget: (siteId: string) => MapE2ECanvasPoint | null
}

declare global {
  interface Window {
    __resilienceMapE2E?: MapE2EApi
  }
}

export default function MapPage() {
  const location    = useLocation()
  const { asOf, isReplaying, asOfParam, signalQueryParams } = useReplayParams()
  const { role }    = useRole()
  const queryClient = useQueryClient()

  const mapContainerRef = useRef<HTMLDivElement>(null)

  // ---------------------------------------------------------------------------
  // Map UI state — passed to engine
  // ---------------------------------------------------------------------------
  const [showSignals,     setShowSignals]     = useState(true)
  const [showCoverage,    setShowCoverage]    = useState(true)
  const [showHeatmap,     setShowHeatmap]     = useState(false)
  const [showChokepoints, setShowChokepoints] = useState(true)
  const [showTrails,      setShowTrails]      = useState(true)
  const [trailWindowMinutes, setTrailWindowMinutes] = useState(30)
  const [mapStyle,        setMapStyle]        = useState<MapStyleKey>('tactical')

  // ---------------------------------------------------------------------------
  // Data queries
  // ---------------------------------------------------------------------------
  const { data: riskData } = useRiskScores({ enabled: !isReplaying, refetchInterval: isReplaying ? false : 60_000 })
  const riskBySiteId = useMemo(
    () => (isReplaying ? {} : Object.fromEntries((riskData ?? []).map(r => [String(r.site_id), r]))),
    [isReplaying, riskData],
  )

  const sitesQuery  = useSites({ per_page: 200, ...asOfParam })
  const tasksQuery  = useTasks({ per_page: 200, ...asOfParam })
  const assetsQuery = useAssets({ per_page: 200, ...asOfParam })
  const { data: areasRes } = useAreasOfOperation({ per_page: 200 }, { enabled: !isReplaying })
  const areaOfOperations = useMemo(
    () => (isReplaying ? [] : (areasRes?.data ?? [])),
    [areasRes?.data, isReplaying],
  )

  const sites    = useMemo(() => sitesQuery.data?.data  ?? [], [sitesQuery.data?.data])
  const allTasks = useMemo(() => tasksQuery.data?.data  ?? [], [tasksQuery.data?.data])
  const assets   = useMemo(() => assetsQuery.data?.data ?? [], [assetsQuery.data?.data])
  const loading  = sitesQuery.isLoading || tasksQuery.isLoading
  const error    = sitesQuery.error?.message ?? tasksQuery.error?.message ?? null

  const { signals, connected: signalsConnected, error: signalError } = useSignalsLive({
    enabled: true,
    asOf,
    replayParams: signalQueryParams,
  })

  // ---------------------------------------------------------------------------
  // Entity selection sync — shared with GlobePage
  // ---------------------------------------------------------------------------
  const {
    selectedSiteId, selectedAssetId, selectedSignalId,
    setSelectedSiteId, setSelectedAssetId, setSelectedSignalId,
    onSiteClick, onAssetClick, onSignalClick,
    updateSelectionRoute,
    urlSelectionAppliedRef,
  } = useEntitySelectionSync({
    source: 'map',
    signals, signalsConnected, signalError,
    sites, assets,
    sitesLoaded: sitesQuery.isSuccess,
    assetsLoaded: assetsQuery.isSuccess,
    isReplaying, asOf,
  })

  const selectedSignal = selectedSignalId ? (signals.find(signal => signal.id === selectedSignalId) ?? null) : null
  const selectedVesselMmsi = selectedSignal?.signal_type === 'vessel_position' ? selectedSignal.external_id : null

  // Vessel lookup — only when a vessel_position signal is selected
  const { data: vesselLookup } = useVessels(
    selectedVesselMmsi ? { mmsi: selectedVesselMmsi, per_page: 1 } : undefined,
    { enabled: !!selectedVesselMmsi, refetchInterval: isReplaying ? false : 30_000 },
  )
  const selectedVesselRecord = vesselLookup?.data?.[0] ?? null
  const selectedVessel = isReplaying ? null : selectedVesselRecord

  // Track history for the selected vessel
  const { data: vesselTrackRes } = useVesselTracks(selectedVesselRecord?.id ?? null, {
    limit: 300,
    ...(isReplaying && asOf ? { to: asOf } : {}),
  })
  const vesselTracks = useMemo(() => vesselTrackRes?.data ?? [], [vesselTrackRes?.data])

  // Replay-only multi-asset trails
  const assetTrails = useAssetTrails(isReplaying ? asOf : null, trailWindowMinutes)

  // Active geofence breach site IDs — backed by an unpaginated backend query
  const { data: activeBreachRes } = useActiveBreachSiteIds({
    enabled: !isReplaying,
    refetchInterval: isReplaying ? false : 10_000,
  })
  const breachedSiteIds = useMemo(
    () => new Set<string>(isReplaying ? [] : (activeBreachRes?.site_ids ?? [])),
    [activeBreachRes?.site_ids, isReplaying],
  )

  const { readings, connected: telemetryConnected } = useTelemetry(true, isReplaying ? asOf : null)

  const tasksBySite = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const task of allTasks) {
      if (!map[task.site_id]) map[task.site_id] = []
      map[task.site_id].push(task)
    }
    return map
  }, [allTasks])

  const { data: chokepointsRes } = useChokepoints({ per_page: 200 }, { enabled: !isReplaying })
  const chokepoints = useMemo(
    () => (isReplaying ? [] : (chokepointsRes?.data ?? [])),
    [chokepointsRes?.data, isReplaying],
  )

  const coverageCircles = useMemo(() => buildCoverageCircles({
    assets, tasks: allTasks, sites, readings, allowHistoricalTelemetry: isReplaying,
  }), [assets, allTasks, isReplaying, sites, readings])

  // ---------------------------------------------------------------------------
  // MapLibre engine
  // ---------------------------------------------------------------------------
  const { mapLoaded, flyTo, getZoom, projectPosition, inspectCanvasPosition } = useMapLibreEngine({
    containerRef: mapContainerRef,
    sites,
    assets,
    signals,
    tasksBySite,
    areaOfOperations,
    breachedSiteIds,
    vesselTracks,
    assetTrails,
    coverageCircles,
    chokepoints,
    readings,
    showSignals,
    showCoverage,
    showHeatmap,
    showChokepoints,
    showTrails: isReplaying && showTrails,
    mapStyle,
    isReplaying,
    selectedSiteId,
    selectedAssetId,
    selectedSignalId,
    onSiteClick,
    onAssetClick,
    onSignalClick,
  })

  // ---------------------------------------------------------------------------
  // URL deep-link selection — fires once per navigation after map is ready
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!mapLoaded || urlSelectionAppliedRef.current) return

    const { siteId, assetId, signalId } = parseEntitySelectionRoute(location.search)

    if (!siteId && !assetId && !signalId) {
      setSelectedSiteId(null)
      setSelectedAssetId(null)
      setSelectedSignalId(null)
      urlSelectionAppliedRef.current = true
      return
    }
    if (siteId) {
      const site = sites.find(s => s.id === siteId)
      if (!site) return
      setSelectedSiteId(site.id)
      setSelectedAssetId(null)
      setSelectedSignalId(null)
      flyTo([Number(site.longitude), Number(site.latitude)], 6)
      urlSelectionAppliedRef.current = true
      return
    }

    if (assetId) {
      const asset = assets.find(a => a.id === assetId)
      if (!asset) return
      const { lat, lng } = assetDisplayPosition(asset, sites, readings, { lat: 37.7749, lng: -122.4194 }, { allowHistorical: isReplaying })
      setSelectedSiteId(null)
      setSelectedAssetId(asset.id)
      setSelectedSignalId(null)
      flyTo([lng, lat], 7)
      urlSelectionAppliedRef.current = true
      return
    }

    if (signalId) {
      const signal = signals.find(s => s.id === signalId)
      if (!signal) return
      setSelectedSiteId(null)
      setSelectedAssetId(null)
      setSelectedSignalId(signal.id)
      flyTo([Number(signal.lng), Number(signal.lat)], 7)
      urlSelectionAppliedRef.current = true
    }
  }, [assets, flyTo, isReplaying, location.search, mapLoaded, readings, setSelectedAssetId, setSelectedSignalId, setSelectedSiteId, signals, sites, urlSelectionAppliedRef])

  // ---------------------------------------------------------------------------
  // Derived selection
  // ---------------------------------------------------------------------------
  const selectedSite        = sites.find(s => s.id === selectedSiteId) ?? null
  const selectedTasks       = selectedSiteId ? (tasksBySite[selectedSiteId] ?? []) : []
  const readiness           = computeReadiness(selectedTasks)
  const selectedAsset       = assets.find(a => a.id === selectedAssetId) ?? null
  const selectedLiveReading = getLiveTelemetryReading(selectedAssetId, readings, { allowHistorical: isReplaying })

  const handleTransitioned = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    queryClient.invalidateQueries({ queryKey: ['readiness'] })
  }, [queryClient])

  useEffect(() => {
    if (typeof window === 'undefined') return

    if (window.localStorage.getItem('resilience.e2e') !== '1') {
      delete window.__resilienceMapE2E
      return
    }

    window.__resilienceMapE2E = {
      getState: () => ({
        mapLoaded,
        zoom: getZoom(),
        telemetryConnected,
        signalsConnected,
        signalCount: signals.length,
        selectedSiteId,
        selectedAssetId,
        selectedSignalId,
      }),
      getFirstSiteTarget: () => {
        const site = sites[0]
        return site ? { id: site.id, name: site.name } : null
      },
      projectPosition: (lng: number, lat: number) => projectPosition(lng, lat),
      getPickableSiteCanvasTarget: (siteId: string) => {
        const site = sites.find(candidate => candidate.id === siteId)
        if (!site) return null

        const basePoint = projectPosition(Number(site.longitude), Number(site.latitude))
        if (!basePoint) return null

        for (const offset of E2E_PICK_SEARCH_OFFSETS) {
          const x = basePoint.x + offset.x
          const y = basePoint.y + offset.y
          const inspection = inspectCanvasPosition(x, y)
          if (inspection?.kind === 'site' && inspection.id === siteId) {
            return { x, y }
          }
        }

        return null
      },
    }

    return () => {
      delete window.__resilienceMapE2E
    }
  }, [getZoom, inspectCanvasPosition, mapLoaded, projectPosition, selectedAssetId, selectedSignalId, selectedSiteId, signals.length, signalsConnected, sites, telemetryConnected])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
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

      {isReplaying && (
        <div className="map-overlay map-overlay--error" style={{ top: 56, left: 16, right: 'auto', bottom: 'auto', maxWidth: 420 }}>
          <Callout intent="warning" title="Replay limitations" compact>
            AO overlays, chokepoint overlays, geofence breach rings, and live vessel enrichment are hidden during replay because those layers are only available as live state. Historical vessel trails remain available up to the replay timestamp.
          </Callout>
        </div>
      )}

      {!isReplaying && signalError && showSignals && (
        <div className="map-overlay map-overlay--error" style={{ top: 56, left: 16, right: 'auto', bottom: 'auto', maxWidth: 420 }}>
          <Callout intent="warning" title="Signal baseline sync degraded" compact>
            Live signal streaming is connected, but the baseline sync is incomplete. Signals may be temporarily missing while the client retries automatically.
          </Callout>
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

      {showCoverage && (
        <div className="map-coverage-legend">
          <div className="map-coverage-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(61,220,132,0.28)', borderColor: '#3ddc84' }} />
            Available footprint
          </div>
          <div className="map-coverage-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(82,130,255,0.24)', borderColor: '#5282ff' }} />
            Assigned footprint
          </div>
          <div className="map-coverage-legend-item">
            <span className="map-coverage-legend-swatch map-coverage-legend-swatch--dashed" style={{ background: 'rgba(255,179,102,0.18)', borderColor: '#ffb366' }} />
            Degraded footprint
          </div>
        </div>
      )}
      <div
        className={`map-coverage-toggle${showCoverage ? ' map-coverage-toggle--active' : ''}`}
        onClick={() => setShowCoverage(v => !v)}
        role="button"
        aria-label="Toggle sensor coverage"
      >
        <span className="map-coverage-toggle-dot" />
        COVERAGE {showCoverage ? 'ON' : 'OFF'}
      </div>

      {/* Chokepoint layer legend + toggle */}
      {!isReplaying && showChokepoints && (
        <div className="map-chokepoint-legend">
          <div className="map-chokepoint-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(255,212,59,0.22)', borderColor: '#ffd43b' }} />
            Monitor
          </div>
          <div className="map-chokepoint-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(255,146,43,0.22)', borderColor: '#ff922b' }} />
            Constrained
          </div>
          <div className="map-chokepoint-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(250,82,82,0.20)', borderColor: '#fa5252' }} />
            Contested
          </div>
          <div className="map-chokepoint-legend-item">
            <span className="map-coverage-legend-swatch map-coverage-legend-swatch--dashed" style={{ background: 'rgba(134,142,150,0.18)', borderColor: '#868e96' }} />
            Closed
          </div>
        </div>
      )}
      {!isReplaying && (
        <div
          className={`map-coverage-toggle${showChokepoints ? ' map-coverage-toggle--active' : ''}`}
          onClick={() => setShowChokepoints(v => !v)}
          role="button"
          aria-label="Toggle chokepoint overlay"
        >
          <span className="map-coverage-toggle-dot" />
          CHOKEPOINTS {showChokepoints ? 'ON' : 'OFF'}
        </div>
      )}

      {/* Asset trail layer toggle + window selector — replay-only */}
      {isReplaying && showTrails && (
        <div className="map-coverage-legend">
          <div className="map-coverage-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(61,220,132,0.28)', borderColor: '#3ddc84' }} />
            Available
          </div>
          <div className="map-coverage-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(82,130,255,0.24)', borderColor: '#5282ff' }} />
            Assigned
          </div>
          <div className="map-coverage-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(255,179,102,0.18)', borderColor: '#ffb366' }} />
            Degraded
          </div>
          <div className="map-coverage-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(134,142,150,0.18)', borderColor: '#868e96' }} />
            Offline
          </div>
        </div>
      )}
      {isReplaying && (
        <>
          <div
            className={`map-coverage-toggle${showTrails ? ' map-coverage-toggle--active' : ''}`}
            onClick={() => setShowTrails(v => !v)}
            role="button"
            aria-label="Toggle asset trails"
          >
            <span className="map-coverage-toggle-dot" />
            TRAILS {showTrails ? 'ON' : 'OFF'}
          </div>
          {showTrails && (
            <select
              className="map-trail-window-select"
              value={trailWindowMinutes}
              onChange={e => setTrailWindowMinutes(Number(e.target.value))}
              aria-label="Trail window"
              title="Trail history window"
            >
              <option value={30}>30 min</option>
              <option value={60}>60 min</option>
              <option value={120}>120 min</option>
            </select>
          )}
        </>
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
      {showSignals && showHeatmap && (
        <div className="map-heatmap-legend">
          <div className="map-heatmap-legend-bar" />
          <div className="map-heatmap-legend-labels">
            <span>LOW DENSITY</span>
            <span>HIGH DENSITY</span>
          </div>
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
      <div
        className={`map-heatmap-toggle${showHeatmap ? ' map-heatmap-toggle--active' : ''}`}
        onClick={() => setShowHeatmap(v => !v)}
        role="button"
        aria-label="Toggle signal heatmap"
      >
        <span className="map-heatmap-toggle-dot" />
        HEATMAP {showHeatmap ? 'ON' : 'OFF'}
      </div>

      {/* ── Site panel ── */}
      {selectedSite && (
        <MapSitePanel
          site={selectedSite}
          tasks={selectedTasks}
          readiness={readiness}
          riskBySiteId={riskBySiteId}
          isReplaying={isReplaying}
          role={role}
          onTransitioned={handleTransitioned}
          onClose={() => {
            setSelectedSiteId(null)
            updateSelectionRoute({ siteId: null, assetId: null, signalId: null })
          }}
        />
      )}

      {/* ── Asset telemetry panel ── */}
      {selectedAsset && (
        <MapAssetPanel
          asset={selectedAsset}
          liveReading={selectedLiveReading}
          isReplaying={isReplaying}
          onClose={() => {
            setSelectedAssetId(null)
            updateSelectionRoute({ siteId: null, assetId: null, signalId: null })
          }}
        />
      )}

      {/* ── Signal info panel ── */}
      {selectedSignal && (
        <MapSignalPanel
          signal={selectedSignal}
          vessel={selectedVessel}
          vesselTracks={vesselTracks}
          isReplaying={isReplaying}
          onClose={() => {
            setSelectedSignalId(null)
            updateSelectionRoute({ siteId: null, assetId: null, signalId: null })
          }}
        />
      )}
    </div>
  )
}
