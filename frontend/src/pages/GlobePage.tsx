import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Callout, Spinner } from '@blueprintjs/core'
import { useSites } from '../hooks/useSites'
import { useTasks } from '../hooks/useTasks'
import { useAssets } from '../hooks/useAssets'
import { useTelemetry } from '../hooks/useTelemetry'
import { useAreasOfOperation } from '../hooks/useAreasOfOperation'
import { useSignalsLive } from '../hooks/useSignals'
import { useVessels, useVesselTracks } from '../hooks/useVessels'
import { useActiveBreachSiteIds } from '../hooks/useSignalRuleMatches'
import { useReplayParams } from '../hooks/useReplayParams'
import { useGlobeEngine } from '../hooks/useGlobeEngine'
import type { Asset, Site, Task, Signal } from '../api/types'
import type { Vessel } from '../api/vessels'
import { useLocation, useNavigate } from 'react-router-dom'
import { assetDisplayPosition, getLiveTelemetryReading } from '../lib/assetPresentation'
import { computeReadiness } from '../lib/formatters'
import { buildCoverageCircles, haversineKm } from '../lib/coverage'
import { buildEntitySelectionPath, buildEntitySelectionSearch, parseEntitySelectionRoute } from '../lib/entitySelectionRoute'
import { isPerfEnabled } from '../lib/perfInstrumentation'
import { SIGNAL_COLORS, SIGNAL_LABELS } from '../lib/signalConfig'
import { GlobeInspectorPanel } from '../components/GlobeInspectorPanel'

// ---------------------------------------------------------------------------
// Helpers
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
    return SIGNAL_LABELS[selectedSignal.signal_type] ?? selectedSignal.signal_type
  return null
}

type GlobeBenchmarkTarget = {
  siteId: string
  siteName: string
  focusedSignalCount: number
  globalSignalCount: number
}

type GlobeBenchmarkState = {
  viewerReady: boolean
  siteCount: number
  signalCount: number
  selectedSiteId: string | null
  selectedAssetId: string | null
  selectedSignalId: string | null
  isCloseView: boolean
  showSignals: boolean
  showCoverage: boolean
  benchmarkTarget: GlobeBenchmarkTarget | null
}

type GlobeBenchmarkApi = {
  getState: () => GlobeBenchmarkState
  getBenchmarkTarget: () => GlobeBenchmarkTarget | null
  focusSite: (siteId: string) => boolean
  focusBestSite: () => GlobeBenchmarkTarget | null
  clearSelection: () => void
  flyHome: () => void
  clearPerf: () => void
  getPerfEvents: () => unknown[]
}

type GlobeE2ETarget = {
  id: string
  name: string
}

type GlobeE2EApi = {
  getState: () => {
    viewerReady: boolean
    selectedSiteId: string | null
    selectedAssetId: string | null
    selectedSignalId: string | null
  }
  getFirstGeofenceTarget: () => GlobeE2ETarget | null
  getFirstCoverageTarget: () => GlobeE2ETarget | null
  flyToSite: (siteId: string) => boolean
  flyToAsset: (assetId: string) => boolean
  pickSiteThroughGeofenceOverlay: (siteId: string) => boolean
  pickSite: (siteId: string) => boolean
  pickAsset: (assetId: string) => boolean
}

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

declare global {
  interface Window {
    __resilienceGlobeBench?: GlobeBenchmarkApi
    __resilienceGlobeE2E?: GlobeE2EApi
  }
}

function pickBenchmarkTarget(sites: Site[], signals: Signal[]): GlobeBenchmarkTarget | null {
  if (sites.length === 0 || signals.length === 0) return null

  let best: GlobeBenchmarkTarget | null = null

  for (const site of sites) {
    const focusedSignalCount = signals.reduce((count, signal) => {
      return count + (
        haversineKm(Number(site.latitude), Number(site.longitude), Number(signal.lat), Number(signal.lng)) <= 2_000
          ? 1
          : 0
      )
    }, 0)

    if (focusedSignalCount === 0) continue

    if (!best || focusedSignalCount < best.focusedSignalCount) {
      best = {
        siteId: site.id,
        siteName: site.name,
        focusedSignalCount,
        globalSignalCount: signals.length,
      }
    }
  }

  if (best) return best

  return {
    siteId: sites[0].id,
    siteName: sites[0].name,
    focusedSignalCount: signals.length,
    globalSignalCount: signals.length,
  }
}

// ---------------------------------------------------------------------------
// GlobePage
// ---------------------------------------------------------------------------
export default function GlobePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { asOf, isReplaying, asOfParam, signalQueryParams } = useReplayParams()
  const urlSelectionAppliedRef = useRef(false)
  const replayResetReadyRef = useRef(false)
  const pendingRouteWriteRef = useRef<string | null>(null)

  // ---------------------------------------------------------------------------
  // Selection state — owned here, driven by engine callbacks
  // ---------------------------------------------------------------------------
  const [selectedSiteId,   setSelectedSiteId]   = useState<string | null>(null)
  const [selectedAssetId,  setSelectedAssetId]  = useState<string | null>(null)
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null)
  const [showSignals,      setShowSignals]      = useState(true)
  const [showCoverage,     setShowCoverage]     = useState(true)

  // ---------------------------------------------------------------------------
  // Data queries
  // ---------------------------------------------------------------------------
  const sitesQuery  = useSites({ per_page: 200, ...asOfParam })
  const tasksQuery  = useTasks({ per_page: 200, ...asOfParam })
  const assetsQuery = useAssets({ per_page: 200, ...asOfParam })
  const { data: areasRes } = useAreasOfOperation({ per_page: 200 }, { enabled: !isReplaying })

  const sites  = useMemo(() => sitesQuery.data?.data  ?? [], [sitesQuery.data?.data])
  const tasks  = useMemo(() => tasksQuery.data?.data  ?? [], [tasksQuery.data?.data])
  const assets = useMemo(() => assetsQuery.data?.data ?? [], [assetsQuery.data?.data])
  const areaOfOperations = useMemo(
    () => (isReplaying ? [] : (areasRes?.data ?? [])),
    [areasRes?.data, isReplaying],
  )
  const { data: activeBreachRes } = useActiveBreachSiteIds({
    enabled: !isReplaying,
    refetchInterval: isReplaying ? false : 10_000,
  })
  const breachedSiteIds = useMemo(
    () => new Set<string>(isReplaying ? [] : (activeBreachRes?.site_ids ?? [])),
    [activeBreachRes?.site_ids, isReplaying],
  )
  const { signals, error: signalError } = useSignalsLive({
    enabled: true,
    asOf,
    replayParams: signalQueryParams,
  })

  const loading = sitesQuery.isLoading || tasksQuery.isLoading
  const { readings, connected: telemetryConnected } = useTelemetry(true, isReplaying ? asOf : null)

  const tasksBySite = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const t of tasks) {
      if (!map[t.site_id]) map[t.site_id] = []
      map[t.site_id].push(t)
    }
    return map
  }, [tasks])

  const coverageCircles = useMemo(() => buildCoverageCircles({
    assets,
    tasks,
    sites,
    readings,
    allowHistoricalTelemetry: isReplaying,
  }), [assets, isReplaying, readings, sites, tasks])

  const updateSelectionRoute = useCallback((selection: {
    siteId: string | null
    assetId: string | null
    signalId: string | null
  }) => {
    const nextSearch = buildEntitySelectionSearch(location.search, selection)
    if (nextSearch === location.search) return

    pendingRouteWriteRef.current = nextSearch
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch,
      },
      { replace: true },
    )
  }, [location.pathname, location.search, navigate])

  const updateSelectionRouteRef = useRef(updateSelectionRoute)
  useEffect(() => {
    updateSelectionRouteRef.current = updateSelectionRoute
  }, [updateSelectionRoute])

  // ---------------------------------------------------------------------------
  // Reset selection on replay timestamp change
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!replayResetReadyRef.current) {
      replayResetReadyRef.current = true
      return
    }
    setSelectedSiteId(null)
    setSelectedAssetId(null)
    setSelectedSignalId(null)
    updateSelectionRouteRef.current({ siteId: null, assetId: null, signalId: null })
  }, [asOf])

  useEffect(() => {
    urlSelectionAppliedRef.current = false
  }, [location.search])

  // ---------------------------------------------------------------------------
  // Derived selection
  // ---------------------------------------------------------------------------
  const selectedSite        = selectedSiteId   ? (sites.find(s => s.id === selectedSiteId)     ?? null) : null
  const selectedTasks       = selectedSiteId   ? (tasksBySite[selectedSiteId] ?? [])            : []
  const selectedAsset       = selectedAssetId  ? (assets.find(a => a.id === selectedAssetId)   ?? null) : null
  const selectedSignal      = selectedSignalId ? (signals.find(s => s.id === selectedSignalId) ?? null) : null
  const selectedLiveReading = getLiveTelemetryReading(selectedAssetId, readings, { allowHistorical: isReplaying })

  // ---------------------------------------------------------------------------
  // Clear signal selection when signals are hidden
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!showSignals) {
      setSelectedSignalId(null)
      updateSelectionRoute({ siteId: selectedSiteId, assetId: selectedAssetId, signalId: null })
    }
  }, [selectedAssetId, selectedSiteId, showSignals, updateSelectionRoute])

  // ---------------------------------------------------------------------------
  // Vessel enrichment — only when a vessel_position signal is selected
  // ---------------------------------------------------------------------------
  const selectedVesselMmsi = selectedSignal?.signal_type === 'vessel_position' ? selectedSignal.external_id : null
  const { data: vesselLookup } = useVessels(
    selectedVesselMmsi ? { mmsi: selectedVesselMmsi, per_page: 1 } : undefined,
    { enabled: !!selectedVesselMmsi && !isReplaying },
  )
  const selectedVessel = vesselLookup?.data?.[0] ?? null
  const { data: vesselTrackRes } = useVesselTracks(!isReplaying ? (selectedVessel?.id ?? null) : null, { limit: 300 })
  const vesselTracks = useMemo(() => vesselTrackRes?.data ?? [], [vesselTrackRes?.data])

  // ---------------------------------------------------------------------------
  // Engine refs
  // ---------------------------------------------------------------------------
  const containerRef = useRef<HTMLDivElement>(null)
  const creditsRef   = useRef<HTMLDivElement>(null)

  const selectedCenter = useMemo(() => {
    if (selectedSite)   return { lat: Number(selectedSite.latitude), lng: Number(selectedSite.longitude) }
    if (selectedSignal) return { lat: Number(selectedSignal.lat), lng: Number(selectedSignal.lng) }
    if (selectedAsset)  return assetDisplayPosition(selectedAsset, sites, readings, { lat: 0, lng: 0 }, { allowHistorical: isReplaying })
    return null
  }, [isReplaying, readings, selectedAsset, selectedSignal, selectedSite, sites])

  const benchmarkTarget = useMemo(
    () => pickBenchmarkTarget(sites, signals),
    [signals, sites],
  )

  // ---------------------------------------------------------------------------
  // Engine init — hook owns signal culling using selectedCenter + camera regime
  // ---------------------------------------------------------------------------
  const { viewerReady, isCloseView, focusPosition, flyToHome, projectRenderedPosition, inspectCanvasPosition, dispatchSyntheticPick, pickCanvasPosition } = useGlobeEngine({
    containerRef,
    creditsRef,
    sites,
    assets,
    signals,
    tasksBySite,
    areaOfOperations,
    breachedSiteIds,
    coverageCircles,
    vesselTracks,
    readings,
    showSignals,
    showCoverage,
    asOf: asOf ?? undefined,
    isReplaying,
    signalFocusCenter: selectedCenter,
    selectedSignalId,
    onSiteClick:   (siteId)   => {
      setSelectedSiteId(siteId)
      setSelectedAssetId(null)
      setSelectedSignalId(null)
      updateSelectionRoute({ siteId, assetId: null, signalId: null })
    },
    onAssetClick:  (assetId)  => {
      setSelectedSiteId(null)
      setSelectedAssetId(assetId)
      setSelectedSignalId(null)
      updateSelectionRoute({ siteId: null, assetId, signalId: null })
    },
    onSignalClick: (signalId) => {
      setSelectedSiteId(null)
      setSelectedAssetId(null)
      setSelectedSignalId(signalId)
      updateSelectionRoute({ siteId: null, assetId: null, signalId })
    },
  })

  // ---------------------------------------------------------------------------
  // URL deep-link selection — fires once per navigation after globe is ready
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!viewerReady || urlSelectionAppliedRef.current) return

    if (pendingRouteWriteRef.current === location.search) {
      pendingRouteWriteRef.current = null
      urlSelectionAppliedRef.current = true
      return
    }

    const { siteId, assetId, signalId } = parseEntitySelectionRoute(location.search)

    if (!siteId && !assetId && !signalId) {
      setSelectedSiteId(null)
      setSelectedAssetId(null)
      setSelectedSignalId(null)
      urlSelectionAppliedRef.current = true
      return
    }

    if (siteId) {
      const site = sites.find(entry => entry.id === siteId)
      if (!site) return
      setSelectedSiteId(site.id)
      setSelectedAssetId(null)
      setSelectedSignalId(null)
      urlSelectionAppliedRef.current = true
      return
    }

    if (assetId) {
      const asset = assets.find(entry => entry.id === assetId)
      if (!asset) return
      setSelectedSiteId(null)
      setSelectedAssetId(asset.id)
      setSelectedSignalId(null)
      urlSelectionAppliedRef.current = true
      return
    }

    if (signalId) {
      const signal = signals.find(entry => entry.id === signalId)
      if (!signal) return
      setSelectedSiteId(null)
      setSelectedAssetId(null)
      setSelectedSignalId(signal.id)
      urlSelectionAppliedRef.current = true
    }
  }, [assets, location.search, signals, sites, viewerReady])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isPerfEnabled()) {
      delete window.__resilienceGlobeBench
      return
    }

    window.__resilienceGlobeBench = {
      getState: () => ({
        viewerReady,
        siteCount: sites.length,
        signalCount: signals.length,
        selectedSiteId,
        selectedAssetId,
        selectedSignalId,
        isCloseView,
        showSignals,
        showCoverage,
        benchmarkTarget,
      }),
      getBenchmarkTarget: () => benchmarkTarget,
      focusSite: (siteId: string) => {
        if (!sites.some(site => site.id === siteId)) return false
        setSelectedSiteId(siteId)
        setSelectedAssetId(null)
        setSelectedSignalId(null)
        return true
      },
      focusBestSite: () => {
        if (!benchmarkTarget) return null
        setSelectedSiteId(benchmarkTarget.siteId)
        setSelectedAssetId(null)
        setSelectedSignalId(null)
        return benchmarkTarget
      },
      clearSelection: () => {
        setSelectedSiteId(null)
        setSelectedAssetId(null)
        setSelectedSignalId(null)
      },
      flyHome: () => {
        flyToHome()
      },
      clearPerf: () => {
        window.__resiliencePerf?.clear()
      },
      getPerfEvents: () => window.__resiliencePerf?.events ?? [],
    }

    return () => {
      delete window.__resilienceGlobeBench
    }
  }, [
    benchmarkTarget,
    flyToHome,
    isCloseView,
    viewerReady,
    selectedAssetId,
    selectedSignalId,
    selectedSiteId,
    showSignals,
    showCoverage,
    signals.length,
    sites,
  ])

  useEffect(() => {
    if (typeof window === 'undefined') return

    if (window.localStorage.getItem('resilience.e2e') !== '1') {
      delete window.__resilienceGlobeE2E
      return
    }

    const geofenceSite = sites.find(site => site.geofence_radius_km > 0) ?? null
    const coverageAssetId = coverageCircles[0]?.assetId ?? null
    const coverageAsset = coverageAssetId ? (assets.find(asset => asset.id === coverageAssetId) ?? null) : null
    const pickRenderedEntity = (expectedIdString: string) => {
      const point = projectRenderedPosition(expectedIdString)
      if (!point) return false

      for (const offset of E2E_PICK_SEARCH_OFFSETS) {
        const x = point.x + offset.x
        const y = point.y + offset.y
        const result = inspectCanvasPosition(x, y)
        if (result.idString !== expectedIdString) continue
        return pickCanvasPosition(x, y)
      }

      return false
    }
    window.__resilienceGlobeE2E = {
      getState: () => ({
        viewerReady,
        selectedSiteId,
        selectedAssetId,
        selectedSignalId,
      }),
      getFirstGeofenceTarget: () => geofenceSite ? { id: geofenceSite.id, name: geofenceSite.name } : null,
      getFirstCoverageTarget: () => coverageAsset ? { id: coverageAsset.id, name: coverageAsset.name } : null,
      flyToSite: (siteId: string) => {
        const site = sites.find(entry => entry.id === siteId)
        if (!site) return false
        focusPosition(Number(site.longitude), Number(site.latitude), 1_200_000, -70)
        return true
      },
      flyToAsset: (assetId: string) => {
        const asset = assets.find(entry => entry.id === assetId)
        if (!asset) return false
        const coords = assetDisplayPosition(asset, sites, readings, { lat: 0, lng: 0 }, { allowHistorical: isReplaying })
        focusPosition(coords.lng, coords.lat, 850_000)
        return true
      },
      pickSiteThroughGeofenceOverlay: (siteId: string) => {
        const site = sites.find(entry => entry.id === siteId)
        if (!site || site.geofence_radius_km <= 0) return false
        return dispatchSyntheticPick([`geofence-${site.id}`, `site-${site.id}`])
      },
      pickSite: (siteId: string) => {
        const site = sites.find(entry => entry.id === siteId)
        if (!site) return false
        return pickRenderedEntity(`site-${site.id}`)
      },
      pickAsset: (assetId: string) => {
        const asset = assets.find(entry => entry.id === assetId)
        if (!asset) return false
        return pickRenderedEntity(`asset-${asset.id}`)
      },
    }

    return () => {
      delete window.__resilienceGlobeE2E
    }
  }, [
    assets,
    coverageCircles,
    focusPosition,
    dispatchSyntheticPick,
    inspectCanvasPosition,
    isReplaying,
    pickCanvasPosition,
    projectRenderedPosition,
    readings,
    selectedAssetId,
    selectedSignalId,
    selectedSiteId,
    sites,
    viewerReady,
  ])

  // ---------------------------------------------------------------------------
  // Focus camera on entity click — called after selection state is set
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!selectedSite) return
    focusPosition(Number(selectedSite.longitude), Number(selectedSite.latitude), 1_200_000, -70)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on siteId change, not on every selectedSite rerender
  }, [selectedSiteId])

  useEffect(() => {
    if (!selectedAsset) return
    const coords = assetDisplayPosition(selectedAsset, sites, readings, { lat: 0, lng: 0 }, { allowHistorical: isReplaying })
    focusPosition(coords.lng, coords.lat, 850_000)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on assetId change
  }, [selectedAssetId, isReplaying])

  useEffect(() => {
    if (!selectedSignal) return
    focusPosition(Number(selectedSignal.lng), Number(selectedSignal.lat), 900_000)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on signalId change
  }, [selectedSignalId])

  // ---------------------------------------------------------------------------
  // Inspector-panel derived values
  // ---------------------------------------------------------------------------
  const readiness = computeReadiness(selectedTasks)
  const selectedAreaOfOperation = selectedSite?.area_of_operation_id
    ? (areaOfOperations.find(ao => ao.id === selectedSite.area_of_operation_id) ?? null)
    : null

  const nearestSignals = useMemo(() => {
    if (!selectedSite) return []
    const lat = Number(selectedSite.latitude)
    const lng = Number(selectedSite.longitude)
    return signals
      .map(signal => ({ signal, distanceKm: haversineKm(lat, lng, Number(signal.lat), Number(signal.lng)) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 5)
  }, [selectedSite, signals])

  const geofenceHits = useMemo(() => {
    if (!selectedSite?.geofence_radius_km) return 0
    return nearestSignals.filter(item => item.distanceKm <= selectedSite.geofence_radius_km).length
  }, [nearestSignals, selectedSite])

  const nearestResponseAssets = useMemo(() => {
    if (!selectedSite) return []
    const lat = Number(selectedSite.latitude)
    const lng = Number(selectedSite.longitude)
    return assets
      .map(asset => {
        const freshReading = getLiveTelemetryReading(asset.id, readings, { allowHistorical: isReplaying })
        const coords = assetDisplayPosition(asset, sites, readings, { lat: 0, lng: 0 }, { allowHistorical: isReplaying })
        return { asset, reading: freshReading, distanceKm: haversineKm(lat, lng, coords.lat, coords.lng) }
      })
      .sort((a, b) => {
        const rank = (s: Asset['status']) => s === 'available' ? 0 : s === 'assigned' ? 1 : s === 'degraded' ? 2 : 3
        return rank(a.asset.status) - rank(b.asset.status) || a.distanceKm - b.distanceKm
      })
      .slice(0, 4)
  }, [assets, isReplaying, readings, selectedSite, sites])

  const tacticalMapHref = buildEntitySelectionPath('/map', location.search, {
    siteId: selectedSite?.id ?? null,
    assetId: selectedAsset?.id ?? null,
    signalId: selectedSignal?.id ?? null,
  })
  const inspectorTitle = getInspectorTitle(selectedSite, selectedAsset, selectedSignal, selectedVessel)

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="globe-page">
      <div ref={containerRef} className="globe-container" />
      <div ref={creditsRef}   className="globe-credits" />

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
            flyToHome()
            setSelectedSiteId(null)
            setSelectedAssetId(null)
            setSelectedSignalId(null)
            updateSelectionRoute({ siteId: null, assetId: null, signalId: null })
          }}
        />
        <div
          className={`globe-signal-toggle${showSignals ? ' globe-signal-toggle--active' : ''}`}
          onClick={() => setShowSignals(v => !v)}
          role="button"
        >
          SIGNALS {showSignals ? 'ON' : 'OFF'}
        </div>
        <div
          className={`globe-signal-toggle${showCoverage ? ' globe-signal-toggle--active' : ''}`}
          onClick={() => setShowCoverage(v => !v)}
          role="button"
        >
          COVERAGE {showCoverage ? 'ON' : 'OFF'}
        </div>
        <span className="globe-toolbar-hint bp6-text-muted">
          {signalError && !isReplaying
            ? 'Live signal baseline sync is incomplete. Signals may be temporarily missing while the client retries.'
            : isReplaying
            ? 'Replay mode hides live-only AO posture, breach overlays, and vessel enrichment data.'
            : isCloseView
            ? 'Signals hidden at close range. Use the 2D map for tactical inspection.'
            : 'Click any site, asset, or signal to inspect it'}
        </span>
        {isCloseView && (
          <Button small icon="map" onClick={() => navigate(tacticalMapHref)}>
            Open Tactical Map
          </Button>
        )}
      </div>

      {!isReplaying && signalError && showSignals && (
        <div className="globe-loading" style={{ top: 64, left: 16, right: 'auto', bottom: 'auto', width: 420, height: 'auto', background: 'transparent', pointerEvents: 'none' }}>
          <Callout intent="warning" title="Signal baseline sync degraded" compact style={{ pointerEvents: 'auto' }}>
            Live signal streaming is connected, but the baseline sync is incomplete. Signals may be temporarily missing while the client retries automatically.
          </Callout>
        </div>
      )}

      {/* ── Entity detail panel ── */}
      {inspectorTitle && (
        <GlobeInspectorPanel
          inspectorTitle={inspectorTitle}
          selectedSite={selectedSite}
          selectedAsset={selectedAsset}
          selectedSignal={selectedSignal}
          selectedVessel={selectedVessel}
          selectedTasks={selectedTasks}
          selectedLiveReading={selectedLiveReading}
          selectedAreaOfOperation={selectedAreaOfOperation}
          nearestSignals={nearestSignals}
          nearestResponseAssets={nearestResponseAssets}
          geofenceHits={geofenceHits}
          readiness={readiness}
          isReplaying={isReplaying}
          telemetryConnected={telemetryConnected}
          tacticalMapHref={tacticalMapHref}
          onClose={() => {
            setSelectedSiteId(null)
            setSelectedAssetId(null)
            setSelectedSignalId(null)
            updateSelectionRoute({ siteId: null, assetId: null, signalId: null })
          }}
          navigate={navigate}
        />
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
        {showCoverage && (
          <>
            <div className="globe-legend-section-title" style={{ marginTop: 10 }}>COVERAGE</div>
            <div className="globe-legend-item">
              <span className="globe-legend-dot" style={{ background: '#3ddc84' }} />Available radius
            </div>
            <div className="globe-legend-item">
              <span className="globe-legend-dot" style={{ background: '#5282ff' }} />Assigned radius
            </div>
            <div className="globe-legend-item">
              <span className="globe-legend-dot" style={{ background: '#ffb366' }} />Degraded radius
            </div>
          </>
        )}
        {showSignals && (
          <>
            <div className="globe-legend-section-title" style={{ marginTop: 10 }}>SIGNALS</div>
            {Object.entries(SIGNAL_LABELS).map(([type, label]) => (
              <div key={type} className="globe-legend-item">
                <span className="globe-legend-dot" style={{ background: SIGNAL_COLORS[type] ?? '#ffffff' }} />
                {label}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
