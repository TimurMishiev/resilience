import { useMemo, useRef, useState, useCallback } from 'react'
import { Button, NonIdealState } from '@blueprintjs/core'
import { useQueryClient } from '@tanstack/react-query'
import { isPerfEnabled } from '../lib/perfInstrumentation'
import { useAllSites } from '../hooks/useSites'
import { useAllTasks } from '../hooks/useTasks'
import { useAllAssets } from '../hooks/useAssets'
import { useTelemetry } from '../hooks/useTelemetry'
import { useAllAreasOfOperation } from '../hooks/useAreasOfOperation'
import { useSignalsLive } from '../hooks/useSignals'
import { buildSyntheticBenchSignals, readBenchSignalCount } from '../lib/benchSyntheticSignals'
import { useVessels, useVesselTracks } from '../hooks/useVessels'
import { useRiskScores } from '../hooks/useRiskScores'
import { useActiveBreachSiteIds } from '../hooks/useSignalRuleMatches'
import { useActiveSiteConfidence } from '../hooks/useActiveSiteConfidence'
import { useAllChokepoints } from '../hooks/useChokepoints'
import { useRole } from '../hooks/useRole'
import { useReferenceTimeMs } from '../hooks/useReferenceTimeMs'
import { useReplayParams } from '../hooks/useReplayParams'
import { useAssetTrails } from '../hooks/useAssetTrails'
import { useEntitySelectionSync } from '../hooks/useEntitySelectionSync'
import { useMapLibreEngine, type MapStyleKey } from '../hooks/useMapLibreEngine'
import { useEvidenceLinkedIds } from '../hooks/useEvidenceLinkedIds'
import { useMapContextPanelState } from '../hooks/useMapContextPanelState'
import { useMapPageDiagnostics } from '../hooks/useMapPageDiagnostics'
import { useMapToolState } from '../hooks/useMapToolState'
import { useMapUrlSelectionHydration } from '../hooks/useMapUrlSelectionHydration'
import type { Signal, Task } from '../api/types'
import { useLocation } from 'react-router-dom'
import { getLiveTelemetryReading } from '../lib/assetPresentation'
import { buildCoverageCircles } from '../lib/coverage'
import { computeReadiness } from '../lib/formatters'
import { buildReplayVessel } from '../lib/replayVessel'
import { MapOverlayControls } from '../components/map/MapOverlayControls'
import { MapSelectionPanels } from '../components/map/MapSelectionPanels'
import { MapInlineDebriefPanel } from '../components/map/MapInlineDebriefPanel'
import { useReplayEventPulses } from '../hooks/useReplayEventPulses'

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
  // Tranche 6-A: replay event pulses default ON. Effective only while
  // isReplaying — live mode does not render the layer regardless.
  const [showReplayPulses, setShowReplayPulses] = useState(true)
  const [trailWindowMinutes, setTrailWindowMinutes] = useState(30)
  const [mapStyle,        setMapStyle]        = useState<MapStyleKey>('tactical')
  const {
    annotationMode,
    annotations,
    bearingLineAnchor,
    bearingLineDegrees,
    bearingLineDegreesInput,
    bearingLineDistanceInput,
    bearingLineDistanceKm,
    bearingLineMode,
    bearingLineUnit,
    clearAnnotations,
    clearBearingLine,
    clearMeasurement,
    clearRangeRings,
    clearSector,
    disableAnnotations,
    disableBearingLine,
    disableMeasurement,
    disableRangeRings,
    disableSector,
    handleMapAnnotationClick,
    handleMapBearingLineAnchorClick,
    handleMapCoordinateClick,
    handleMapRangeRingAnchorClick,
    handleMapSectorAnchorClick,
    measurementMode,
    measurementPoints,
    rangeRingAnchor,
    rangeRingInputs,
    rangeRingMode,
    rangeRingRadiiKm,
    rangeRingUnit,
    removeAnnotation,
    sectorAnchor,
    sectorArcDegrees,
    sectorArcInput,
    sectorDegrees,
    sectorDegreesInput,
    sectorDistanceInput,
    sectorDistanceKm,
    sectorMode,
    sectorUnit,
    setBearingLineDisplayUnit,
    setRangeRingDisplayUnit,
    setSectorDisplayUnit,
    toggleAnnotations,
    toggleBearingLine,
    toggleMeasurement,
    toggleRangeRings,
    toggleSector,
    updateAnnotationLabel,
    updateBearingLineDegreesInput,
    updateBearingLineDistanceInput,
    updateRangeRingInput,
    updateSectorArcInput,
    updateSectorDegreesInput,
    updateSectorDistanceInput,
  } = useMapToolState()

  // ---------------------------------------------------------------------------
  // Data queries
  // ---------------------------------------------------------------------------
  const { data: riskData } = useRiskScores(asOfParam, { refetchInterval: isReplaying ? false : 60_000 })
  const riskBySiteId = useMemo(
    () => Object.fromEntries((riskData ?? []).map(r => [String(r.site_id), r])),
    [riskData],
  )

  const sitesQuery  = useAllSites(asOfParam)
  const tasksQuery  = useAllTasks(asOfParam)
  const assetsQuery = useAllAssets(asOfParam)
  const { data: areasRes } = useAllAreasOfOperation(asOfParam)
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

  // Tranche 6-D-map: per-site max confidence among active alerts.
  // Backed by an unpaginated backend summary endpoint so page caps cannot
  // silently omit active sites. Replay-only — gated on `isReplaying` so
  // live `/map` sessions issue no hidden requests for an empty halo layer.
  const { data: confidenceSummaryRes } = useActiveSiteConfidence(asOfParam, {
    enabled: isReplaying,
    refetchInterval: false,
  })
  const confidenceHaloSummaries = useMemo(
    () => confidenceSummaryRes?.summaries ?? [],
    [confidenceSummaryRes?.summaries],
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

  const { data: chokepointsRes } = useAllChokepoints(asOfParam, true)
  const chokepoints = useMemo(
    () => chokepointsRes?.data ?? [],
    [chokepointsRes?.data],
  )

  const coverageCircles = useMemo(() => buildCoverageCircles({
    assets, tasks: allTasks, sites, readings, allowHistoricalTelemetry: isReplaying,
  }), [assets, allTasks, isReplaying, sites, readings])

  // Tranche 6-A: replay event pulses. Hook is internally disabled when
  // !isReplaying || !asOf, so live mode and pre-cursor states return [].
  const replayPulses = useReplayEventPulses({ asOf, isReplaying, sites })

  // ---------------------------------------------------------------------------
  // MapLibre engine
  // ---------------------------------------------------------------------------
  const { mapLoaded, engineError, retryEngine, flyTo, getZoom, projectPosition, inspectCanvasPosition, resize } = useMapLibreEngine({
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
    rangeRingMode,
    rangeRingAnchor,
    rangeRingRadiiKm,
    rangeRingUnit,
    sectorMode,
    sectorAnchor,
    sectorDegrees,
    sectorArcDegrees,
    sectorDistanceKm,
    sectorUnit,
    bearingLineMode,
    bearingLineAnchor,
    bearingLineDegrees,
    bearingLineDistanceKm,
    bearingLineUnit,
    measurementMode,
    measurementPoints,
    evidenceSignalIds,
    evidenceSiteIds,
    replayPulses,
    showReplayPulses: isReplaying && showReplayPulses,
    confidenceHaloSummaries,
    onSiteClick,
    onAssetClick,
    onSignalClick,
    onMapAnnotationClick: handleMapAnnotationClick,
    onMapRangeRingAnchorClick: handleMapRangeRingAnchorClick,
    onMapSectorAnchorClick: handleMapSectorAnchorClick,
    onMapBearingLineAnchorClick: handleMapBearingLineAnchorClick,
    onMapCoordinateClick: handleMapCoordinateClick,
  })

  // ---------------------------------------------------------------------------
  // URL deep-link selection — fires once per navigation after map is ready
  // ---------------------------------------------------------------------------
  useMapUrlSelectionHydration({
    mapLoaded,
    location,
    sites,
    assets,
    signals,
    readings,
    isReplaying,
    flyTo,
    urlSelectionAppliedRef,
    setSelectedSiteId,
    setSelectedAssetId,
    setSelectedSignalId,
  })

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

  const hasSelection = Boolean(selectedSiteId || selectedAssetId || selectedSignalId)

  const clearSelection = useCallback(() => {
    setSelectedSiteId(null)
    setSelectedAssetId(null)
    setSelectedSignalId(null)
    updateSelectionRoute({ siteId: null, assetId: null, signalId: null })
  }, [setSelectedSiteId, setSelectedAssetId, setSelectedSignalId, updateSelectionRoute])

  const {
    closePanel,
    contextPanelOpen,
    handleResizeStart,
    panelRef,
    panelWidth,
  } = useMapContextPanelState({
    annotationMode,
    bearingLineMode,
    contextHasSelection: hasSelection,
    disableAnnotations,
    disableBearingLine,
    disableMeasurement,
    disableRangeRings,
    disableSector,
    mapLoaded,
    measurementMode,
    onClearSelection: clearSelection,
    rangeRingMode,
    resize,
    sectorMode,
  })

  useMapPageDiagnostics({
    getZoom,
    inspectCanvasPosition,
    mapLoaded,
    projectPosition,
    selectedAssetId,
    selectedSignalId,
    selectedSiteId,
    setSelectedAssetId,
    setSelectedSignalId,
    setSelectedSiteId,
    showCoverage,
    showHeatmap,
    showSignals,
    signalCount: signals.length,
    signals,
    signalsConnected,
    sites,
    telemetryConnected,
  })

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className={`map-page${contextPanelOpen ? ' map-page--panel-open' : ''}`}>
      <div className="map-viewport">
        <div ref={mapContainerRef} className="map-container" />

        {/* Engine init failure overlay. Without this, a CDN failure on
            the maplibre-gl dynamic import or a WebGL-context-unavailable
            browser left the user staring at a blank canvas with no error
            state. The hook's retryEngine clears the error and re-runs
            the init effect; the overlay vanishes when init succeeds. */}
        {engineError && (
          <div className="map-engine-error-overlay" role="alert">
            <NonIdealState
              icon="error"
              title="Map engine failed to load"
              description={
                <>
                  <p>{engineError.message}</p>
                  <p style={{ fontSize: 12, color: 'var(--bp5-text-color-muted)' }}>
                    This usually means the map runtime could not be downloaded
                    (network blip, CDN outage) or the browser is missing WebGL
                    support.
                  </p>
                </>
              }
              action={
                <Button intent="primary" icon="refresh" onClick={retryEngine}>
                  Retry
                </Button>
              }
            />
          </div>
        )}

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
        showReplayPulses={showReplayPulses}
        pulseCount={replayPulses.length}
        annotationMode={annotationMode}
        annotations={annotations}
        rangeRingMode={rangeRingMode}
        rangeRingAnchor={rangeRingAnchor}
        rangeRingInputs={rangeRingInputs}
        rangeRingRadiiKm={rangeRingRadiiKm}
        rangeRingUnit={rangeRingUnit}
        sectorMode={sectorMode}
        sectorAnchor={sectorAnchor}
        sectorDegreesInput={sectorDegreesInput}
        sectorDegrees={sectorDegrees}
        sectorArcInput={sectorArcInput}
        sectorArcDegrees={sectorArcDegrees}
        sectorDistanceInput={sectorDistanceInput}
        sectorDistanceKm={sectorDistanceKm}
        sectorUnit={sectorUnit}
        bearingLineMode={bearingLineMode}
        bearingLineAnchor={bearingLineAnchor}
        bearingLineDegreesInput={bearingLineDegreesInput}
        bearingLineDegrees={bearingLineDegrees}
        bearingLineDistanceInput={bearingLineDistanceInput}
        bearingLineDistanceKm={bearingLineDistanceKm}
        bearingLineUnit={bearingLineUnit}
        measurementMode={measurementMode}
        measurementPoints={measurementPoints}
        onMapStyleChange={setMapStyle}
        onToggleCoverage={() => setShowCoverage(v => !v)}
        onToggleChokepoints={() => setShowChokepoints(v => !v)}
        onToggleTrails={() => setShowTrails(v => !v)}
        onTrailWindowChange={setTrailWindowMinutes}
        onToggleSignals={() => setShowSignals(v => !v)}
        onToggleHeatmap={() => setShowHeatmap(v => !v)}
        onToggleReplayPulses={() => setShowReplayPulses(v => !v)}
        onToggleAnnotations={toggleAnnotations}
        onClearAnnotations={clearAnnotations}
        onUpdateAnnotationLabel={updateAnnotationLabel}
        onRemoveAnnotation={removeAnnotation}
        onToggleRangeRings={toggleRangeRings}
        onClearRangeRings={clearRangeRings}
        onUpdateRangeRingInput={updateRangeRingInput}
        onSetRangeRingUnit={setRangeRingDisplayUnit}
        onToggleSector={toggleSector}
        onClearSector={clearSector}
        onUpdateSectorDegreesInput={updateSectorDegreesInput}
        onUpdateSectorArcInput={updateSectorArcInput}
        onUpdateSectorDistanceInput={updateSectorDistanceInput}
        onSetSectorUnit={setSectorDisplayUnit}
        onToggleBearingLine={toggleBearingLine}
        onClearBearingLine={clearBearingLine}
        onUpdateBearingLineDegreesInput={updateBearingLineDegreesInput}
        onUpdateBearingLineDistanceInput={updateBearingLineDistanceInput}
        onSetBearingLineUnit={setBearingLineDisplayUnit}
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
          <MapInlineDebriefPanel />
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
