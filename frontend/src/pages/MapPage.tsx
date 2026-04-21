import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isPerfEnabled } from '../lib/perfInstrumentation'
import { useMapBenchmarkBridge } from '../hooks/useMapBenchmarkBridge'
import type { MapBenchmarkState, MapBenchmarkTarget } from '../components/map/types'
import { useSites } from '../hooks/useSites'
import { useTasks } from '../hooks/useTasks'
import { useAssets } from '../hooks/useAssets'
import { useTelemetry } from '../hooks/useTelemetry'
import { useAreasOfOperation } from '../hooks/useAreasOfOperation'
import { useSignalsLive } from '../hooks/useSignals'
import { buildSyntheticBenchSignals, readBenchSignalCount } from '../lib/benchSyntheticSignals'
import { useVessels, useVesselTracks } from '../hooks/useVessels'
import { useRiskScores } from '../hooks/useRiskScores'
import { useActiveBreachSiteIds } from '../hooks/useSignalRuleMatches'
import { useChokepoints } from '../hooks/useChokepoints'
import { useRole } from '../hooks/useRole'
import { useReferenceTimeMs } from '../hooks/useReferenceTimeMs'
import { useReplayParams } from '../hooks/useReplayParams'
import { useAssetTrails } from '../hooks/useAssetTrails'
import { useMapE2EBridge } from '../hooks/useMapE2EBridge'
import { useEntitySelectionSync } from '../hooks/useEntitySelectionSync'
import { useMapLibreEngine, type MapStyleKey } from '../hooks/useMapLibreEngine'
import { useEvidenceLinkedIds } from '../hooks/useEvidenceLinkedIds'
import type { Signal, Task } from '../api/types'
import { useLocation } from 'react-router-dom'
import { assetDisplayPosition, getLiveTelemetryReading } from '../lib/assetPresentation'
import { buildCoverageCircles } from '../lib/coverage'
import { parseEntitySelectionRoute } from '../lib/entitySelectionRoute'
import { computeReadiness } from '../lib/formatters'
import { buildReplayVessel } from '../lib/replayVessel'
import type { MapMeasurementPoint } from '../lib/mapMeasurement'
import type { MapAnnotation } from '../lib/mapAnnotations'
import { MapOverlayControls } from '../components/map/MapOverlayControls'
import { MapSelectionPanels } from '../components/map/MapSelectionPanels'

export default function MapPage() {
  const location    = useLocation()
  const { asOf, isReplaying, asOfParam, signalQueryParams } = useReplayParams()
  const { role, canTriageAlerts } = useRole()
  const referenceTimeMs = useReferenceTimeMs(isReplaying ? asOf : null)
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
  const [annotationMode, setAnnotationMode] = useState(false)
  const [annotations, setAnnotations] = useState<MapAnnotation[]>([])
  const [measurementMode, setMeasurementMode] = useState(false)
  const [measurementPoints, setMeasurementPoints] = useState<MapMeasurementPoint[]>([])
  const nextAnnotationIdRef = useRef(1)

  // ---------------------------------------------------------------------------
  // Data queries
  // ---------------------------------------------------------------------------
  const { data: riskData } = useRiskScores(asOfParam, { refetchInterval: isReplaying ? false : 60_000 })
  const riskBySiteId = useMemo(
    () => Object.fromEntries((riskData ?? []).map(r => [String(r.site_id), r])),
    [riskData],
  )

  const sitesQuery  = useSites({ per_page: 200, ...asOfParam })
  const tasksQuery  = useTasks({ per_page: 200, ...asOfParam })
  const assetsQuery = useAssets({ per_page: 200, ...asOfParam })
  const { data: areasRes } = useAreasOfOperation({ per_page: 200, ...asOfParam })
  const areaOfOperations = useMemo(
    () => areasRes?.data ?? [],
    [areasRes?.data],
  )

  const sites    = useMemo(() => sitesQuery.data?.data  ?? [], [sitesQuery.data?.data])
  const allTasks = useMemo(() => tasksQuery.data?.data  ?? [], [tasksQuery.data?.data])
  const assets   = useMemo(() => assetsQuery.data?.data ?? [], [assetsQuery.data?.data])
  const loading  = sitesQuery.isLoading || tasksQuery.isLoading
  const error    = sitesQuery.error?.message ?? tasksQuery.error?.message ?? null

  // Bench-mode synthetic-signal override.  When the map-scale benchmark sets
  // both `resilience.perf` and `resilience.perf.bench_signal_count`, we bypass
  // /api/signals (server-capped at per_page=200) and feed a deterministic
  // synthetic array straight into the signal pipeline so reconcile cost can be
  // characterized at 1k / 10k / 100k.  Read once at mount so changing the flag
  // requires a reload (matches the other perf flags).
  const benchSignalCount = useMemo(
    () => (isPerfEnabled() ? readBenchSignalCount() : null),
    [],
  )
  const syntheticBenchSignals = useMemo<Signal[] | null>(
    () => (benchSignalCount === null ? null : buildSyntheticBenchSignals(benchSignalCount)),
    [benchSignalCount],
  )

  const liveSignals = useSignalsLive({
    enabled: syntheticBenchSignals === null,
    asOf,
    replayParams: signalQueryParams,
  })
  const signals          = syntheticBenchSignals ?? liveSignals.signals
  const signalsConnected = syntheticBenchSignals !== null ? true : liveSignals.connected
  const signalError      = syntheticBenchSignals !== null ? null : liveSignals.error

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

  const { evidenceSignalIds, evidenceSiteIds } = useEvidenceLinkedIds(selectedSiteId, selectedSignalId, asOf)

  const selectedSignal = selectedSignalId ? (signals.find(signal => signal.id === selectedSignalId) ?? null) : null
  const selectedVesselMmsi = selectedSignal?.signal_type === 'vessel_position' ? selectedSignal.external_id : null

  // Vessel lookup — only when a vessel_position signal is selected
  const { data: vesselLookup } = useVessels(
    selectedVesselMmsi ? { mmsi: selectedVesselMmsi, per_page: 1 } : undefined,
    { enabled: !!selectedVesselMmsi, refetchInterval: isReplaying ? false : 30_000 },
  )
  const selectedVesselRecord = vesselLookup?.data?.[0] ?? null

  // Track history for the selected vessel
  const { data: vesselTrackRes } = useVesselTracks(selectedVesselRecord?.id ?? null, {
    limit: 300,
    ...(isReplaying && asOf ? { to: asOf } : {}),
  })
  const vesselTracks = useMemo(() => vesselTrackRes?.data ?? [], [vesselTrackRes?.data])
  const selectedVessel = useMemo(
    () => (isReplaying
      ? buildReplayVessel(selectedSignal, selectedVesselRecord?.id ?? null, vesselTracks, asOf)
      : selectedVesselRecord),
    [asOf, isReplaying, selectedSignal, selectedVesselRecord, vesselTracks],
  )

  // Replay-only multi-asset trails
  const assetTrails = useAssetTrails(isReplaying ? asOf : null, trailWindowMinutes)

  // Active geofence breach site IDs — backed by an unpaginated backend query
  const { data: activeBreachRes } = useActiveBreachSiteIds(asOfParam, {
    enabled: true,
    refetchInterval: isReplaying ? false : 10_000,
  })
  const breachedSiteIds = useMemo(
    () => new Set<string>(activeBreachRes?.site_ids ?? []),
    [activeBreachRes?.site_ids],
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

  const { data: chokepointsRes } = useChokepoints({ per_page: 200, ...asOfParam }, { enabled: true })
  const chokepoints = useMemo(
    () => chokepointsRes?.data ?? [],
    [chokepointsRes?.data],
  )

  const coverageCircles = useMemo(() => buildCoverageCircles({
    assets, tasks: allTasks, sites, readings, allowHistoricalTelemetry: isReplaying,
  }), [assets, allTasks, isReplaying, sites, readings])

  // ---------------------------------------------------------------------------
  // MapLibre engine
  // ---------------------------------------------------------------------------
  const { mapLoaded, flyTo, getZoom, projectPosition, inspectCanvasPosition, resize } = useMapLibreEngine({
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
    referenceTimeMs,
    selectedSiteId,
    selectedAssetId,
    selectedSignalId,
    annotationMode,
    annotations,
    measurementMode,
    measurementPoints,
    evidenceSignalIds,
    evidenceSiteIds,
    onSiteClick,
    onAssetClick,
    onSignalClick,
    onMapAnnotationClick: point => {
      const nextId = nextAnnotationIdRef.current++
      setAnnotations(previous => [...previous, {
        id: `annotation-${nextId}`,
        label: `Mark ${nextId}`,
        lat: point.lat,
        lng: point.lng,
      }])
    },
    onMapCoordinateClick: point => {
      setMeasurementPoints(previous => (previous.length >= 2 ? [point] : [...previous, point]))
    },
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

  const [panelForceOpen, setPanelForceOpen] = useState(false)
  const [panelWidth, setPanelWidth]         = useState(360)
  const panelRef = useRef<HTMLElement>(null)

  const hasSelection = Boolean(selectedSiteId || selectedAssetId || selectedSignalId)
  const contextPanelOpen = hasSelection || panelForceOpen

  const clearSelection = useCallback(() => {
    setSelectedSiteId(null)
    setSelectedAssetId(null)
    setSelectedSignalId(null)
    updateSelectionRoute({ siteId: null, assetId: null, signalId: null })
  }, [setSelectedSiteId, setSelectedAssetId, setSelectedSignalId, updateSelectionRoute])

  const clearMeasurement = useCallback(() => {
    setMeasurementPoints([])
  }, [])

  const clearAnnotations = useCallback(() => {
    nextAnnotationIdRef.current = 1
    setAnnotations([])
  }, [])

  const updateAnnotationLabel = useCallback((annotationId: string, label: string) => {
    setAnnotations(previous => previous.map(annotation => (
      annotation.id === annotationId ? { ...annotation, label } : annotation
    )))
  }, [])

  const removeAnnotation = useCallback((annotationId: string) => {
    setAnnotations(previous => previous.filter(annotation => annotation.id !== annotationId))
  }, [])

  const disableAnnotations = useCallback(() => {
    setAnnotationMode(false)
  }, [])

  const disableMeasurement = useCallback(() => {
    setMeasurementMode(false)
    setMeasurementPoints([])
  }, [])

  const toggleMeasurement = useCallback(() => {
    if (measurementMode) {
      disableMeasurement()
      return
    }

    setMeasurementMode(true)
    setMeasurementPoints([])
    disableAnnotations()
  }, [disableAnnotations, disableMeasurement, measurementMode])

  const toggleAnnotations = useCallback(() => {
    if (annotationMode) {
      disableAnnotations()
      return
    }

    disableMeasurement()
    setAnnotationMode(true)
  }, [annotationMode, disableAnnotations, disableMeasurement])

  const closePanel = useCallback(() => {
    setPanelForceOpen(false)
    clearSelection()
  }, [clearSelection])

  // Re-measure the map whenever the docked panel opens/closes or resizes so
  // MapLibre's internal viewport matches the new container width.
  useEffect(() => {
    if (!mapLoaded) return
    const frame = requestAnimationFrame(() => resize())
    return () => cancelAnimationFrame(frame)
  }, [contextPanelOpen, panelWidth, mapLoaded, resize])

  // ] toggles the panel; Escape closes it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (event.key === ']') {
        event.preventDefault()
        if (contextPanelOpen) {
          closePanel()
        } else {
          setPanelForceOpen(true)
        }
        return
      }
      if (event.key === 'Escape') {
        if (measurementMode) {
          disableMeasurement()
          return
        }
        if (annotationMode) {
          disableAnnotations()
          return
        }
        if (contextPanelOpen) {
          closePanel()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [annotationMode, contextPanelOpen, closePanel, disableAnnotations, disableMeasurement, measurementMode])

  // Resize handle drag — reads starting width from the DOM so the callback
  // has no panelWidth dep and doesn't re-render on every mousemove frame.
  const handleResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = panelRef.current?.offsetWidth ?? 360

      const onMouseMove = (e: MouseEvent) => {
        const delta = startX - e.clientX
        setPanelWidth(Math.min(600, Math.max(240, startWidth + delta)))
      }
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [],
  )

  useMapE2EBridge({
    mapLoaded,
    getZoom,
    telemetryConnected,
    signalsConnected,
    signalCount: signals.length,
    selectedSiteId,
    selectedAssetId,
    selectedSignalId,
    sites,
    projectPosition,
    inspectCanvasPosition,
  })

  // ---------------------------------------------------------------------------
  // Benchmark bridge — exposes window.__resilienceMapBench when localStorage
  // 'resilience.perf' is '1'.  Used by e2e/map-benchmark.spec.ts to drive
  // deterministic selection-change reconciles and read perf events back.
  // ---------------------------------------------------------------------------
  const perfEnabled = useMemo(() => isPerfEnabled(), [])

  const benchmarkTarget: MapBenchmarkTarget | null = useMemo(() => {
    if (signals.length === 0) return null
    const firstSignal = [...signals].sort((a, b) => a.id.localeCompare(b.id))[0]
    return {
      signalId: firstSignal.id,
      signalType: firstSignal.signal_type,
      globalSignalCount: signals.length,
    }
  }, [signals])

  const benchStateRef = useRef<MapBenchmarkState>({
    mapLoaded: false,
    siteCount: 0,
    signalCount: 0,
    selectedSiteId: null,
    selectedAssetId: null,
    selectedSignalId: null,
    showSignals: true,
    showHeatmap: false,
    showCoverage: true,
    benchmarkTarget: null,
  })
  const benchSitesRef = useRef(sites)
  useEffect(() => {
    benchStateRef.current = {
      mapLoaded,
      siteCount: sites.length,
      signalCount: signals.length,
      selectedSiteId,
      selectedAssetId,
      selectedSignalId,
      showSignals,
      showHeatmap,
      showCoverage,
      benchmarkTarget,
    }
    benchSitesRef.current = sites
  }, [mapLoaded, sites, signals.length, selectedSiteId, selectedAssetId, selectedSignalId, showSignals, showHeatmap, showCoverage, benchmarkTarget])

  useMapBenchmarkBridge({
    perfEnabled,
    stateRef: benchStateRef,
    sitesRef: benchSitesRef,
    setSelectedSiteId,
    setSelectedAssetId,
    setSelectedSignalId,
  })

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className={`map-page${contextPanelOpen ? ' map-page--panel-open' : ''}`}>
      <div className="map-viewport">
        <div ref={mapContainerRef} className="map-container" />

        <MapOverlayControls
        loading={loading}
        error={error}
        isReplaying={isReplaying}
        telemetryConnected={telemetryConnected}
        signalError={signalError}
        mapStyle={mapStyle}
        showCoverage={showCoverage}
        showChokepoints={showChokepoints}
        showTrails={showTrails}
        trailWindowMinutes={trailWindowMinutes}
        showSignals={showSignals}
        showHeatmap={showHeatmap}
        annotationMode={annotationMode}
        annotations={annotations}
        measurementMode={measurementMode}
        measurementPoints={measurementPoints}
        onMapStyleChange={setMapStyle}
        onToggleCoverage={() => setShowCoverage(v => !v)}
        onToggleChokepoints={() => setShowChokepoints(v => !v)}
        onToggleTrails={() => setShowTrails(v => !v)}
        onTrailWindowChange={setTrailWindowMinutes}
        onToggleSignals={() => setShowSignals(v => !v)}
        onToggleHeatmap={() => setShowHeatmap(v => !v)}
        onToggleAnnotations={toggleAnnotations}
        onClearAnnotations={clearAnnotations}
        onUpdateAnnotationLabel={updateAnnotationLabel}
        onRemoveAnnotation={removeAnnotation}
        onToggleMeasurement={toggleMeasurement}
        onClearMeasurement={clearMeasurement}
      />
      </div>

      {contextPanelOpen && (
        <aside
          ref={panelRef}
          className="map-context-panel"
          role="complementary"
          aria-label="Map selection detail"
          style={{ flexBasis: panelWidth, width: panelWidth }}
        >
          <div
            className="map-context-panel-resize-handle"
            onMouseDown={handleResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            data-testid="panel-resize-handle"
          />
          {hasSelection ? (
            <MapSelectionPanels
              selectedSite={selectedSite}
              selectedTasks={selectedTasks}
              readiness={readiness}
              riskBySiteId={riskBySiteId}
              role={role}
              canTriage={canTriageAlerts}
              referenceTimeMs={referenceTimeMs}
              selectedAsset={selectedAsset}
              selectedLiveReading={selectedLiveReading}
              selectedSignal={selectedSignal}
              selectedVessel={selectedVessel}
              vesselTracks={vesselTracks}
              isReplaying={isReplaying}
              onSelectSite={onSiteClick}
              onSelectSignal={onSignalClick}
              onTransitioned={handleTransitioned}
              onCloseSite={closePanel}
              onCloseAsset={closePanel}
              onCloseSignal={closePanel}
            />
          ) : (
            <div className="map-context-panel-empty bp6-text-muted" data-testid="panel-empty-state">
              Select a site, asset, or signal on the map to view details.
              <br /><br />
              Press <kbd>]</kbd> or <kbd>Esc</kbd> to close this panel.
            </div>
          )}
        </aside>
      )}
    </div>
  )
}
