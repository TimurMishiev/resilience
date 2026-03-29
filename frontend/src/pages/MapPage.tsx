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
import { useRole } from '../hooks/useRole'
import { useReplayParams } from '../hooks/useReplayParams'
import { useMapLibreEngine, MAP_STYLE_CONFIGS, type MapStyleKey } from '../hooks/useMapLibreEngine'
import type { Task } from '../api/types'
import { useLocation, useNavigate } from 'react-router-dom'
import { assetDisplayPosition, getLiveTelemetryReading } from '../lib/assetPresentation'
import { buildCoverageCircles } from '../lib/coverage'
import {
  buildEntitySelectionSearch,
  buildEntitySelectionSyncLocationState,
  consumeEntitySelectionSyncLocationState,
  isEntitySelectionRouteAuthoritative,
  parseEntitySelectionRoute,
  shouldClearEntitySelectionAfterLoad,
  trackEntitySelectionSyncToken,
} from '../lib/entitySelectionRoute'
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
  const navigate    = useNavigate()
  const { asOf, isReplaying, asOfParam, signalQueryParams } = useReplayParams()
  const { role }    = useRole()
  const queryClient = useQueryClient()

  const mapContainerRef        = useRef<HTMLDivElement>(null)
  const urlSelectionAppliedRef = useRef(false)
  const replayResetReadyRef    = useRef(false)
  const nextRouteWriteTokenRef = useRef(0)
  const pendingRouteWriteTokensRef = useRef<Set<number>>(new Set())

  // ---------------------------------------------------------------------------
  // Selection state — owned here, driven by engine callbacks
  // ---------------------------------------------------------------------------
  const [selectedSiteId,   setSelectedSiteId]   = useState<string | null>(null)
  const [selectedAssetId,  setSelectedAssetId]  = useState<string | null>(null)
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Map UI state — passed to engine
  // ---------------------------------------------------------------------------
  const [showSignals,  setShowSignals]  = useState(true)
  const [showCoverage, setShowCoverage] = useState(true)
  const [showHeatmap,  setShowHeatmap]  = useState(false)
  const [mapStyle,     setMapStyle]     = useState<MapStyleKey>('tactical')

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

  const { signals, connected: signalsConnected, error: signalError } = useSignalsLive({
    enabled: true,
    asOf,
    replayParams: signalQueryParams,
  })

  // ---------------------------------------------------------------------------
  // SSE grace period — prevents the stale-selection clear from firing before
  // the stream has had a chance to deliver post-baseline signals for a
  // deep-linked signal URL.  Scoped to the React Router location.key so that
  // every distinct navigation attempt — including same-signal retries in a
  // long-lived session — gets a fresh 1500 ms window.  signalsSettledKey
  // holds the location.key whose window has elapsed; null means no attempt
  // has settled yet (or the stream disconnected).
  // ---------------------------------------------------------------------------
  const [signalsSettledKey, setSignalsSettledKey] = useState<string | null>(null)
  const signalsSettledTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const signalsSettledTimerForRef  = useRef<string | null>(null)

  useEffect(() => {
    if (!signalsConnected || signalError != null) {
      /* eslint-disable react-hooks/set-state-in-effect -- Resets internal grace-window state on disconnect or error; no selection state is mutated and no URL write occurs */
      setSignalsSettledKey(null)
      /* eslint-enable react-hooks/set-state-in-effect */
      signalsSettledTimerForRef.current = null
      if (signalsSettledTimerRef.current != null) {
        clearTimeout(signalsSettledTimerRef.current)
        signalsSettledTimerRef.current = null
      }
      return
    }

    const routeSignalId = parseEntitySelectionRoute(location.search).signalId
    if (routeSignalId == null) return  // no signal deep-linked; nothing to wait for

    // Cancel the running timer when the navigation key changes (new route attempt).
    if (
      signalsSettledTimerRef.current != null &&
      signalsSettledTimerForRef.current !== location.key
    ) {
      clearTimeout(signalsSettledTimerRef.current)
      signalsSettledTimerRef.current = null
      signalsSettledTimerForRef.current = null
    }

    if (signalsSettledTimerRef.current != null) return  // timer already running for this attempt

    const thisKey = location.key
    signalsSettledTimerForRef.current = thisKey
    signalsSettledTimerRef.current = setTimeout(() => {
      setSignalsSettledKey(thisKey)
      signalsSettledTimerRef.current = null
    }, 1500)

    return () => {
      if (signalsSettledTimerRef.current != null) {
        clearTimeout(signalsSettledTimerRef.current)
        signalsSettledTimerRef.current = null
      }
    }
  }, [signalsConnected, signalError, location.search, location.key])

  const selectedSignal = selectedSignalId ? (signals.find(signal => signal.id === selectedSignalId) ?? null) : null
  const selectedVesselMmsi = selectedSignal?.signal_type === 'vessel_position' ? selectedSignal.external_id : null

  // Vessel lookup — only when a vessel_position signal is selected
  const { data: vesselLookup } = useVessels(
    selectedVesselMmsi ? { mmsi: selectedVesselMmsi, per_page: 1 } : undefined,
    { enabled: !!selectedVesselMmsi && !isReplaying },
  )
  const selectedVessel = vesselLookup?.data?.[0] ?? null

  // Track history for the selected vessel
  const { data: vesselTrackRes } = useVesselTracks(!isReplaying ? (selectedVessel?.id ?? null) : null, { limit: 300 })
  const vesselTracks = useMemo(() => vesselTrackRes?.data ?? [], [vesselTrackRes?.data])

  // Active geofence breach site IDs — backed by an unpaginated backend query
  const { data: activeBreachRes } = useActiveBreachSiteIds({
    enabled: !isReplaying,
    refetchInterval: isReplaying ? false : 10_000,
  })
  const breachedSiteIds = useMemo(
    () => new Set<string>(isReplaying ? [] : (activeBreachRes?.site_ids ?? [])),
    [activeBreachRes?.site_ids, isReplaying],
  )

  const sites    = useMemo(() => sitesQuery.data?.data  ?? [], [sitesQuery.data?.data])
  const allTasks = useMemo(() => tasksQuery.data?.data  ?? [], [tasksQuery.data?.data])
  const assets   = useMemo(() => assetsQuery.data?.data ?? [], [assetsQuery.data?.data])
  const loading  = sitesQuery.isLoading || tasksQuery.isLoading
  const error    = sitesQuery.error?.message ?? tasksQuery.error?.message ?? null

  const { readings, connected: telemetryConnected } = useTelemetry(true, isReplaying ? asOf : null)

  const tasksBySite = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const task of allTasks) {
      if (!map[task.site_id]) map[task.site_id] = []
      map[task.site_id].push(task)
    }
    return map
  }, [allTasks])

  const coverageCircles = useMemo(() => buildCoverageCircles({
    assets, tasks: allTasks, sites, readings, allowHistoricalTelemetry: isReplaying,
  }), [assets, allTasks, isReplaying, sites, readings])

  const updateSelectionRoute = useCallback((selection: {
    siteId: string | null
    assetId: string | null
    signalId: string | null
  }) => {
    const nextSearch = buildEntitySelectionSearch(location.search, selection)
    if (nextSearch === location.search) return

    const token = nextRouteWriteTokenRef.current + 1
    nextRouteWriteTokenRef.current = token
    trackEntitySelectionSyncToken(pendingRouteWriteTokensRef.current, token)
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch,
      },
      {
        replace: true,
        state: buildEntitySelectionSyncLocationState(location.state, {
          source: 'map',
          token,
        }),
      },
    )
  }, [location.pathname, location.search, location.state, navigate])

  const updateSelectionRouteRef = useRef(updateSelectionRoute)
  useEffect(() => {
    updateSelectionRouteRef.current = updateSelectionRoute
  }, [updateSelectionRoute])

  // ---------------------------------------------------------------------------
  // Selection callbacks — engine fires these, page owns state
  // ---------------------------------------------------------------------------
  const onSiteClick = useCallback((siteId: string | null) => {
    const nextSiteId = siteId
    setSelectedAssetId(null)
    setSelectedSignalId(null)
    setSelectedSiteId(nextSiteId)
    updateSelectionRoute({ siteId: nextSiteId, assetId: null, signalId: null })
  }, [updateSelectionRoute])

  const onAssetClick = useCallback((assetId: string | null) => {
    const nextAssetId = assetId
    setSelectedSiteId(null)
    setSelectedSignalId(null)
    setSelectedAssetId(nextAssetId)
    updateSelectionRoute({ siteId: null, assetId: nextAssetId, signalId: null })
  }, [updateSelectionRoute])

  const onSignalClick = useCallback((signalId: string | null) => {
    const nextSignalId = signalId
    setSelectedSiteId(null)
    setSelectedAssetId(null)
    setSelectedSignalId(nextSignalId)
    updateSelectionRoute({ siteId: null, assetId: null, signalId: nextSignalId })
  }, [updateSelectionRoute])

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
    coverageCircles,
    readings,
    showSignals,
    showCoverage,
    showHeatmap,
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
  // Reset selection on replay timestamp change (React 18 batches these → 1 paint)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!replayResetReadyRef.current) {
      replayResetReadyRef.current = true
      return
    }
    /* eslint-disable react-hooks/set-state-in-effect -- Replay timestamp changes must synchronously clear selection before route propagation to keep UI and URL in lockstep */
    setSelectedSiteId(null)
    setSelectedAssetId(null)
    setSelectedSignalId(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    updateSelectionRouteRef.current({ siteId: null, assetId: null, signalId: null })
  }, [asOf])

  useEffect(() => {
    urlSelectionAppliedRef.current = false
  }, [location.search])

  // ---------------------------------------------------------------------------
  // URL deep-link selection — fires once per navigation after map is ready
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!mapLoaded || urlSelectionAppliedRef.current) return

    if (consumeEntitySelectionSyncLocationState(location.state, 'map', pendingRouteWriteTokensRef.current)) {
      urlSelectionAppliedRef.current = true
      return
    }

    const { siteId, assetId, signalId } = parseEntitySelectionRoute(location.search)

    /* eslint-disable react-hooks/set-state-in-effect -- URL selection hydration must synchronously reconcile panel state before the first focused flyTo */
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
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [assets, flyTo, isReplaying, location.search, location.state, mapLoaded, readings, signals, sites])

  useEffect(() => {
    const routeSelection = parseEntitySelectionRoute(location.search)

    const availability = {
      sitesLoaded: sitesQuery.isSuccess,
      assetsLoaded: assetsQuery.isSuccess,
      // signalsLoaded must not become true prematurely when a signal is
      // deep-linked but has not yet arrived via SSE.  The SSE stream seeds
      // from the snapshot cursor, so a brand-new signal may be delivered
      // 100–500 ms after the baseline completes.  We defer the "loaded"
      // declaration until one of the following is true:
      //   • replay mode: snapshots are the complete truth, no SSE lag
      //   • the URL selection was already applied (signal found and set)
      //   • no signal is deep-linked (nothing to wait for)
      //   • the signal is already in the current dataset (baseline had it)
      //   • 1500 ms grace period expired (bounded fallback for non-existent signals)
      signalsLoaded: signalsConnected && signalError == null && (
        isReplaying ||
        urlSelectionAppliedRef.current ||
        routeSelection.signalId == null ||
        signals.some(s => s.id === routeSelection.signalId) ||
        signalsSettledKey === location.key
      ),
      siteIds: sites.map(site => site.id),
      assetIds: assets.map(asset => asset.id),
      signalIds: signals.map(signal => signal.id),
    }

    const stateSelection = {
      siteId: selectedSiteId,
      assetId: selectedAssetId,
      signalId: selectedSignalId,
    }
    const routeAuthoritative = isEntitySelectionRouteAuthoritative(location.state, 'map')

    if (!shouldClearEntitySelectionAfterLoad(routeSelection, stateSelection, availability, routeAuthoritative)) {
      return
    }

    /* eslint-disable react-hooks/set-state-in-effect -- When a previously selected entity disappears after its dataset settles, state and URL must be synchronously cleared together to avoid stale selection truth */
    setSelectedSiteId(null)
    setSelectedAssetId(null)
    setSelectedSignalId(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    updateSelectionRouteRef.current({ siteId: null, assetId: null, signalId: null })
  }, [
    assets,
    assetsQuery.isSuccess,
    isReplaying,
    location.key,
    location.search,
    location.state,
    selectedAssetId,
    selectedSignalId,
    selectedSiteId,
    signalError,
    signals,
    signalsConnected,
    signalsSettledKey,
    sites,
    sitesQuery.isSuccess,
  ])

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
            AO overlays, geofence breach rings, and vessel enrichment are hidden during replay because those layers are only available as live state.
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
