import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Callout, Spinner } from '@blueprintjs/core'
import { useSites } from '../hooks/useSites'
import { useTasks } from '../hooks/useTasks'
import { useAssets } from '../hooks/useAssets'
import { useTelemetry } from '../hooks/useTelemetry'
import { useAreasOfOperation } from '../hooks/useAreasOfOperation'
import { useSignalsLive } from '../hooks/useSignals'
import { useAssetTrails } from '../hooks/useAssetTrails'
import { useVessels, useVesselTracks } from '../hooks/useVessels'
import { useActiveBreachSiteIds } from '../hooks/useSignalRuleMatches'
import { useChokepoints } from '../hooks/useChokepoints'
import { useReplayParams } from '../hooks/useReplayParams'
import { useGlobeEngine } from '../hooks/useGlobeEngine'
import { useGlobeE2EBridge } from '../hooks/useGlobeE2EBridge'
import { useGlobeBenchmarkBridge } from '../hooks/useGlobeBenchmarkBridge'
import type { Asset, Site, Signal, Task } from '../api/types'
import type { Vessel } from '../api/vessels'
import { useLocation, useNavigate } from 'react-router-dom'
import { assetDisplayPosition, getLiveTelemetryReading } from '../lib/assetPresentation'
import { computeReadiness } from '../lib/formatters'
import { buildCoverageCircles, haversineKm } from '../lib/coverage'
import {
  buildEntitySelectionPath,
  buildEntitySelectionSearch,
  buildEntitySelectionSyncLocationState,
  consumeEntitySelectionSyncLocationState,
  isEntitySelectionRouteAuthoritative,
  parseEntitySelectionRoute,
  shouldClearEntitySelectionAfterLoad,
  trackEntitySelectionSyncToken,
} from '../lib/entitySelectionRoute'
import { isPerfEnabled } from '../lib/perfInstrumentation'
import { SIGNAL_LABELS } from '../lib/signalConfig'
import { GlobeInspectorPanel } from '../components/GlobeInspectorPanel'
import { GlobeToolbar } from '../components/globe/GlobeToolbar'
import { GlobeLegend } from '../components/globe/GlobeLegend'
import type { GlobeBenchmarkState, GlobeE2EBridgeState } from '../components/globe/types'

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

function pickBenchmarkTarget(sites: Site[], signals: Signal[]) {
  if (sites.length === 0 || signals.length === 0) return null

  let best: { siteId: string; siteName: string; focusedSignalCount: number; globalSignalCount: number } | null = null

  for (const site of sites) {
    const focusedSignalCount = signals.reduce((count, signal) =>
      count + (haversineKm(Number(site.latitude), Number(site.longitude), Number(signal.lat), Number(signal.lng)) <= 2_000 ? 1 : 0),
    0)
    if (focusedSignalCount === 0) continue
    if (!best || focusedSignalCount < best.focusedSignalCount) {
      best = { siteId: site.id, siteName: site.name, focusedSignalCount, globalSignalCount: signals.length }
    }
  }

  return best ?? { siteId: sites[0].id, siteName: sites[0].name, focusedSignalCount: signals.length, globalSignalCount: signals.length }
}

// ---------------------------------------------------------------------------
// GlobePage
// ---------------------------------------------------------------------------
export default function GlobePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { asOf, isReplaying, asOfParam, signalQueryParams } = useReplayParams()
  const urlSelectionAppliedRef      = useRef(false)
  const replayResetReadyRef         = useRef(false)
  const nextRouteWriteTokenRef      = useRef(0)
  const pendingRouteWriteTokensRef  = useRef<Set<number>>(new Set())

  // ── Selection state ─────────────────────────────────────────────────────────
  const [selectedSiteId,   setSelectedSiteId]   = useState<string | null>(null)
  const [selectedAssetId,  setSelectedAssetId]  = useState<string | null>(null)
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null)
  const [showSignals,      setShowSignals]      = useState(true)
  const [showHeatmap,      setShowHeatmap]      = useState(false)
  const [showCoverage,     setShowCoverage]     = useState(true)
  const [showChokepoints,  setShowChokepoints]  = useState(true)
  const [showTrails,       setShowTrails]       = useState(true)
  const [trailWindowMinutes, setTrailWindowMinutes] = useState(30)

  // ── Data queries ─────────────────────────────────────────────────────────────
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

  const { signals, connected: signalsConnected, error: signalError } = useSignalsLive({
    enabled: true,
    asOf,
    replayParams: signalQueryParams,
  })

  // SSE grace period — same pattern as MapPage
  const [signalsSettledKey, setSignalsSettledKey] = useState<string | null>(null)
  const signalsSettledTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const signalsSettledTimerForRef  = useRef<string | null>(null)

  useEffect(() => {
    if (!signalsConnected || signalError != null) {
      setSignalsSettledKey(null)
      signalsSettledTimerForRef.current = null
      if (signalsSettledTimerRef.current != null) {
        clearTimeout(signalsSettledTimerRef.current)
        signalsSettledTimerRef.current = null
      }
      return
    }
    const routeSignalId = parseEntitySelectionRoute(location.search).signalId
    if (routeSignalId == null) return
    if (signalsSettledTimerRef.current != null && signalsSettledTimerForRef.current !== location.key) {
      clearTimeout(signalsSettledTimerRef.current)
      signalsSettledTimerRef.current = null
      signalsSettledTimerForRef.current = null
    }
    if (signalsSettledTimerRef.current != null) return
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
    assets, tasks, sites, readings, allowHistoricalTelemetry: isReplaying,
  }), [assets, isReplaying, readings, sites, tasks])

  const { data: chokepointsRes } = useChokepoints({ per_page: 200 }, { enabled: !isReplaying })
  const chokepoints = useMemo(
    () => (isReplaying ? [] : (chokepointsRes?.data ?? [])),
    [chokepointsRes?.data, isReplaying],
  )

  // ── Route management ─────────────────────────────────────────────────────────
  const updateSelectionRoute = useCallback((selection: {
    siteId: string | null; assetId: string | null; signalId: string | null
  }) => {
    const nextSearch = buildEntitySelectionSearch(location.search, selection)
    if (nextSearch === location.search) return
    const token = nextRouteWriteTokenRef.current + 1
    nextRouteWriteTokenRef.current = token
    trackEntitySelectionSyncToken(pendingRouteWriteTokensRef.current, token)
    navigate(
      { pathname: location.pathname, search: nextSearch },
      { replace: true, state: buildEntitySelectionSyncLocationState(location.state, { source: 'globe', token }) },
    )
  }, [location.pathname, location.search, location.state, navigate])

  const updateSelectionRouteRef = useRef(updateSelectionRoute)
  useEffect(() => { updateSelectionRouteRef.current = updateSelectionRoute }, [updateSelectionRoute])

  useEffect(() => {
    if (!replayResetReadyRef.current) { replayResetReadyRef.current = true; return }
    setSelectedSiteId(null)
    setSelectedAssetId(null)
    setSelectedSignalId(null)
    updateSelectionRouteRef.current({ siteId: null, assetId: null, signalId: null })
  }, [asOf])

  useEffect(() => { urlSelectionAppliedRef.current = false }, [location.search])

  // ── Derived selection ────────────────────────────────────────────────────────
  const selectedSite        = selectedSiteId   ? (sites.find(s => s.id === selectedSiteId)     ?? null) : null
  const selectedTasks       = selectedSiteId   ? (tasksBySite[selectedSiteId] ?? [])            : []
  const selectedAsset       = selectedAssetId  ? (assets.find(a => a.id === selectedAssetId)   ?? null) : null
  const selectedSignal      = selectedSignalId ? (signals.find(s => s.id === selectedSignalId) ?? null) : null
  const selectedLiveReading = getLiveTelemetryReading(selectedAssetId, readings, { allowHistorical: isReplaying })

  useEffect(() => {
    if (!showSignals) {
      setSelectedSignalId(null)
      updateSelectionRoute({ siteId: selectedSiteId, assetId: selectedAssetId, signalId: null })
    }
  }, [selectedAssetId, selectedSiteId, showSignals, updateSelectionRoute])

  // ── Vessel enrichment ─────────────────────────────────────────────────────────
  const selectedVesselMmsi = selectedSignal?.signal_type === 'vessel_position' ? selectedSignal.external_id : null
  const { data: vesselLookup } = useVessels(
    selectedVesselMmsi ? { mmsi: selectedVesselMmsi, per_page: 1 } : undefined,
    { enabled: !!selectedVesselMmsi, refetchInterval: isReplaying ? false : 30_000 },
  )
  const selectedVesselRecord = vesselLookup?.data?.[0] ?? null
  const selectedVessel = isReplaying ? null : selectedVesselRecord
  const { data: vesselTrackRes } = useVesselTracks(selectedVesselRecord?.id ?? null, {
    limit: 300,
    ...(isReplaying && asOf ? { to: asOf } : {}),
  })
  const vesselTracks = useMemo(() => vesselTrackRes?.data ?? [], [vesselTrackRes?.data])
  const assetTrails  = useAssetTrails(isReplaying ? asOf : null, trailWindowMinutes)

  // ── Engine init ───────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null)
  const creditsRef   = useRef<HTMLDivElement>(null)

  const selectedCenter = useMemo(() => {
    if (selectedSite)   return { lat: Number(selectedSite.latitude), lng: Number(selectedSite.longitude) }
    if (selectedSignal) return { lat: Number(selectedSignal.lat), lng: Number(selectedSignal.lng) }
    if (selectedAsset)  return assetDisplayPosition(selectedAsset, sites, readings, { lat: 0, lng: 0 }, { allowHistorical: isReplaying })
    return null
  }, [isReplaying, readings, selectedAsset, selectedSignal, selectedSite, sites])

  const onSiteClick  = useCallback((siteId:   string | null) => { setSelectedSiteId(siteId);   setSelectedAssetId(null); setSelectedSignalId(null); updateSelectionRoute({ siteId,   assetId: null,   signalId: null }) }, [updateSelectionRoute])
  const onAssetClick = useCallback((assetId:  string | null) => { setSelectedSiteId(null); setSelectedAssetId(assetId);  setSelectedSignalId(null); updateSelectionRoute({ siteId: null, assetId,  signalId: null }) }, [updateSelectionRoute])
  const onSignalClick= useCallback((signalId: string | null) => { setSelectedSiteId(null); setSelectedAssetId(null); setSelectedSignalId(signalId); updateSelectionRoute({ siteId: null, assetId: null, signalId }) }, [updateSelectionRoute])

  const benchmarkTarget = useMemo(() => pickBenchmarkTarget(sites, signals), [signals, sites])

  const { viewerReady, isCloseView, focusPosition, flyToHome, projectPosition, projectRenderedPosition, inspectCanvasPosition, dispatchSyntheticPick, pickCanvasPosition } = useGlobeEngine({
    containerRef, creditsRef,
    sites, assets, signals, tasksBySite, areaOfOperations, breachedSiteIds,
    coverageCircles, chokepoints, vesselTracks, assetTrails, readings,
    showSignals, showHeatmap, showCoverage, showChokepoints,
    showTrails: isReplaying && showTrails,
    asOf: asOf ?? undefined, isReplaying,
    signalFocusCenter: selectedCenter,
    selectedSiteId, selectedAssetId, selectedSignalId,
    onSiteClick, onAssetClick, onSignalClick,
  })

  const perfEnabled = isPerfEnabled()

  // ── Benchmark bridge refs ────────────────────────────────────────────────────
  const benchStateRef = useRef<GlobeBenchmarkState>({
    viewerReady: false, siteCount: 0, signalCount: 0,
    selectedSiteId: null, selectedAssetId: null, selectedSignalId: null,
    isCloseView: false, showSignals: true, showHeatmap: false, showCoverage: true,
    benchmarkTarget: null,
  })
  const benchSitesRef   = useRef(sites)
  const flyToHomeRef    = useRef(flyToHome)

  useEffect(() => {
    benchStateRef.current = {
      viewerReady, siteCount: sites.length, signalCount: signals.length,
      selectedSiteId, selectedAssetId, selectedSignalId,
      isCloseView, showSignals, showHeatmap, showCoverage, benchmarkTarget,
    }
    benchSitesRef.current = sites
    flyToHomeRef.current  = flyToHome
  }, [benchmarkTarget, flyToHome, isCloseView, selectedAssetId, selectedSignalId, selectedSiteId, showCoverage, showHeatmap, showSignals, signals.length, sites, viewerReady])

  useGlobeBenchmarkBridge({
    perfEnabled, stateRef: benchStateRef, sitesRef: benchSitesRef, flyToHomeRef,
    setSelectedSiteId, setSelectedAssetId, setSelectedSignalId,
  })

  // ── E2E bridge ────────────────────────────────────────────────────────────────
  const globeE2EBridgeStateRef = useRef<GlobeE2EBridgeState | null>(null)
  globeE2EBridgeStateRef.current = {
    viewerReady, selectedSiteId, selectedAssetId, selectedSignalId,
    sites, assets, signals, coverageCircles, readings, isReplaying,
    focusPosition, projectPosition, projectRenderedPosition,
    inspectCanvasPosition, dispatchSyntheticPick, pickCanvasPosition,
  }
  useGlobeE2EBridge(globeE2EBridgeStateRef)

  // ── URL deep-link selection ────────────────────────────────────────────────
  useEffect(() => {
    if (!viewerReady || urlSelectionAppliedRef.current) return
    if (consumeEntitySelectionSyncLocationState(location.state, 'globe', pendingRouteWriteTokensRef.current)) {
      urlSelectionAppliedRef.current = true
      return
    }
    const { siteId, assetId, signalId } = parseEntitySelectionRoute(location.search)
    if (!siteId && !assetId && !signalId) { setSelectedSiteId(null); setSelectedAssetId(null); setSelectedSignalId(null); urlSelectionAppliedRef.current = true; return }
    if (siteId) {
      const site = sites.find(e => e.id === siteId)
      if (!site) return
      setSelectedSiteId(site.id); setSelectedAssetId(null); setSelectedSignalId(null)
      urlSelectionAppliedRef.current = true; return
    }
    if (assetId) {
      const asset = assets.find(e => e.id === assetId)
      if (!asset) return
      setSelectedSiteId(null); setSelectedAssetId(asset.id); setSelectedSignalId(null)
      urlSelectionAppliedRef.current = true; return
    }
    if (signalId) {
      const signal = signals.find(e => e.id === signalId)
      if (!signal) return
      setSelectedSiteId(null); setSelectedAssetId(null); setSelectedSignalId(signal.id)
      urlSelectionAppliedRef.current = true
    }
  }, [assets, location.search, location.state, signals, sites, viewerReady])

  useEffect(() => {
    const routeSelection = parseEntitySelectionRoute(location.search)
    const availability = {
      sitesLoaded:   sitesQuery.isSuccess,
      assetsLoaded:  assetsQuery.isSuccess,
      signalsLoaded: signalsConnected && signalError == null && (
        isReplaying || urlSelectionAppliedRef.current ||
        routeSelection.signalId == null || signals.some(s => s.id === routeSelection.signalId) ||
        signalsSettledKey === location.key
      ),
      siteIds:   sites.map(s => s.id),
      assetIds:  assets.map(a => a.id),
      signalIds: signals.map(s => s.id),
    }
    const stateSelection = { siteId: selectedSiteId, assetId: selectedAssetId, signalId: selectedSignalId }
    const routeAuthoritative = isEntitySelectionRouteAuthoritative(location.state, 'globe')
    if (!shouldClearEntitySelectionAfterLoad(routeSelection, stateSelection, availability, routeAuthoritative)) return
    setSelectedSiteId(null); setSelectedAssetId(null); setSelectedSignalId(null)
    updateSelectionRouteRef.current({ siteId: null, assetId: null, signalId: null })
  }, [assets, assetsQuery.isSuccess, isReplaying, location.key, location.search, location.state, selectedAssetId, selectedSignalId, selectedSiteId, signalError, signals, signalsConnected, signalsSettledKey, sites, sitesQuery.isSuccess])

  // ── Focus camera on entity click ───────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on id change
  useEffect(() => { if (selectedSite) focusPosition(Number(selectedSite.longitude), Number(selectedSite.latitude), 1_200_000, -70) }, [selectedSiteId])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on id change
  useEffect(() => { if (selectedAsset) { const coords = assetDisplayPosition(selectedAsset, sites, readings, { lat: 0, lng: 0 }, { allowHistorical: isReplaying }); focusPosition(coords.lng, coords.lat, 850_000) } }, [selectedAssetId, isReplaying])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on id change
  useEffect(() => { if (selectedSignal) focusPosition(Number(selectedSignal.lng), Number(selectedSignal.lat), 900_000) }, [selectedSignalId])

  // ── Inspector-panel derived values ─────────────────────────────────────────
  const readiness = computeReadiness(selectedTasks)
  const selectedAreaOfOperation = selectedSite?.area_of_operation_id
    ? (areaOfOperations.find(ao => ao.id === selectedSite.area_of_operation_id) ?? null)
    : null
  const nearestSignals = useMemo(() => {
    if (!selectedSite) return []
    const lat = Number(selectedSite.latitude), lng = Number(selectedSite.longitude)
    return signals
      .map(signal => ({ signal, distanceKm: haversineKm(lat, lng, Number(signal.lat), Number(signal.lng)) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 5)
  }, [selectedSite, signals])
  const geofenceHits = useMemo(() =>
    selectedSite?.geofence_radius_km
      ? nearestSignals.filter(item => item.distanceKm <= selectedSite.geofence_radius_km).length
      : 0,
    [nearestSignals, selectedSite],
  )
  const nearestResponseAssets = useMemo(() => {
    if (!selectedSite) return []
    const lat = Number(selectedSite.latitude), lng = Number(selectedSite.longitude)
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
    siteId: selectedSite?.id ?? null, assetId: selectedAsset?.id ?? null, signalId: selectedSignal?.id ?? null,
  })
  const inspectorTitle = getInspectorTitle(selectedSite, selectedAsset, selectedSignal, selectedVessel)

  function clearSelection() {
    setSelectedSiteId(null)
    setSelectedAssetId(null)
    setSelectedSignalId(null)
    updateSelectionRoute({ siteId: null, assetId: null, signalId: null })
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="globe-page">
      <div ref={containerRef} className="globe-container" />
      <div ref={creditsRef}   className="globe-credits" />

      {loading && <div className="globe-loading"><Spinner /></div>}

      <GlobeToolbar
        showSignals={showSignals}
        showHeatmap={showHeatmap}
        showCoverage={showCoverage}
        showChokepoints={showChokepoints}
        showTrails={showTrails}
        trailWindowMinutes={trailWindowMinutes}
        isReplaying={isReplaying}
        isCloseView={isCloseView}
        signalError={signalError}
        tacticalMapHref={tacticalMapHref}
        onHome={clearSelection}
        onToggleSignals={() => setShowSignals(v => !v)}
        onToggleHeatmap={() => setShowHeatmap(v => !v)}
        onToggleCoverage={() => setShowCoverage(v => !v)}
        onToggleChokepoints={() => setShowChokepoints(v => !v)}
        onToggleTrails={() => setShowTrails(v => !v)}
        onTrailWindowChange={setTrailWindowMinutes}
        onTacticalMap={() => navigate(tacticalMapHref)}
      />

      {!isReplaying && signalError && showSignals && (
        <div className="globe-loading" style={{ top: 64, left: 16, right: 'auto', bottom: 'auto', width: 420, height: 'auto', background: 'transparent', pointerEvents: 'none' }}>
          <Callout intent="warning" title="Signal baseline sync degraded" compact style={{ pointerEvents: 'auto' }}>
            Live signal streaming is connected, but the baseline sync is incomplete. Signals may be temporarily missing while the client retries automatically.
          </Callout>
        </div>
      )}

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
          onClose={clearSelection}
          navigate={navigate}
        />
      )}

      <GlobeLegend
        showSignals={showSignals}
        showHeatmap={showHeatmap}
        showCoverage={showCoverage}
        showChokepoints={showChokepoints}
        isReplaying={isReplaying}
      />
    </div>
  )
}
