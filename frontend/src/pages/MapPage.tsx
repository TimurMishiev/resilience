import { useRef, useState } from 'react'
import { Button, NonIdealState } from '@blueprintjs/core'
import { useEntitySelectionSync } from '../hooks/useEntitySelectionSync'
import { useRole } from '../hooks/useRole'
import { useReferenceTimeMs } from '../hooks/useReferenceTimeMs'
import { useReplayParams } from '../hooks/useReplayParams'
import { useMapLibreEngine, type MapStyleKey } from '../hooks/useMapLibreEngine'
import { useEvidenceLinkedIds } from '../hooks/useEvidenceLinkedIds'
import { useMapContextPanelState } from '../hooks/useMapContextPanelState'
import { useMapPageData } from '../hooks/useMapPageData'
import { useMapPageDiagnostics } from '../hooks/useMapPageDiagnostics'
import { useMapSelectionState } from '../hooks/useMapSelectionState'
import { useMapToolState } from '../hooks/useMapToolState'
import { useMapUrlSelectionHydration } from '../hooks/useMapUrlSelectionHydration'
import { useLocation } from 'react-router-dom'
import { MapOverlayControls } from '../components/map/MapOverlayControls'
import { MapSelectionPanels } from '../components/map/MapSelectionPanels'
import { MapInlineDebriefPanel } from '../components/map/MapInlineDebriefPanel'

export default function MapPage() {
  const location    = useLocation()
  const { asOf, isReplaying, asOfParam, signalQueryParams } = useReplayParams()
  const { role, canTriageAlerts } = useRole()
  const referenceTimeMs = useReferenceTimeMs(isReplaying ? asOf : null)

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

  const {
    allTasks,
    areaOfOperations,
    assetTrails,
    assets,
    assetsLoaded,
    breachedSiteIds,
    chokepoints,
    confidenceHaloSummaries,
    coverageCircles,
    error,
    loading,
    readings,
    replayPulses,
    riskBySiteId,
    signalError,
    signals,
    signalsConnected,
    sites,
    sitesLoaded,
    telemetryConnected,
  } = useMapPageData({
    asOf,
    asOfParam,
    isReplaying,
    signalQueryParams,
    trailWindowMinutes,
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
    sitesLoaded,
    assetsLoaded,
    isReplaying, asOf,
  })

  const { evidenceSignalIds, evidenceSiteIds } = useEvidenceLinkedIds(selectedSiteId, selectedSignalId, asOf)

  const {
    clearSelection,
    handleTransitioned,
    hasSelection,
    readiness,
    selectedAsset,
    selectedLiveReading,
    selectedSignal,
    selectedSite,
    selectedTasks,
    selectedVessel,
    tasksBySite,
    vesselTracks,
  } = useMapSelectionState({
    allTasks,
    assets,
    asOf,
    isReplaying,
    readings,
    selectedAssetId,
    selectedSignalId,
    selectedSiteId,
    setSelectedAssetId,
    setSelectedSignalId,
    setSelectedSiteId,
    signals,
    sites,
    updateSelectionRoute,
  })

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
