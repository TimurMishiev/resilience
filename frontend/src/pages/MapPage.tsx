import { useRef } from 'react'
import { useRole } from '../hooks/useRole'
import { useReferenceTimeMs } from '../hooks/useReferenceTimeMs'
import { useReplayParams } from '../hooks/useReplayParams'
import { useMapContextPanelState } from '../hooks/useMapContextPanelState'
import { useMapDisplayState } from '../hooks/useMapDisplayState'
import { useMapEngineOrchestration } from '../hooks/useMapEngineOrchestration'
import { useMapPageData } from '../hooks/useMapPageData'
import { useMapSelectionOrchestration } from '../hooks/useMapSelectionOrchestration'
import { useMapToolState } from '../hooks/useMapToolState'
import { useLocation } from 'react-router-dom'
import { MapContextPanelSurface } from '../components/map/MapContextPanelSurface'
import type { MapSelectionPanelsProps } from '../components/map/MapSelectionPanels'
import { MapViewportSurface } from '../components/map/MapViewportSurface'

export default function MapPage() {
  const location = useLocation()
  const { asOf, isReplaying, asOfParam, signalQueryParams } = useReplayParams()
  const { role, canTriageAlerts } = useRole()
  const referenceTimeMs = useReferenceTimeMs(isReplaying ? asOf : null)

  const mapContainerRef = useRef<HTMLDivElement>(null)

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
    buildOverlayControlsProps,
    mapStyle,
    showChokepoints,
    showCoverage,
    showHeatmap,
    showReplayPulses,
    showSignals,
    showTrails,
    trailWindowMinutes,
  } = useMapDisplayState({
    isReplaying,
    annotationMode,
    annotations,
    rangeRingMode,
    rangeRingAnchor,
    rangeRingInputs,
    rangeRingRadiiKm,
    rangeRingUnit,
    sectorMode,
    sectorAnchor,
    sectorDegreesInput,
    sectorDegrees,
    sectorArcInput,
    sectorArcDegrees,
    sectorDistanceInput,
    sectorDistanceKm,
    sectorUnit,
    bearingLineMode,
    bearingLineAnchor,
    bearingLineDegreesInput,
    bearingLineDegrees,
    bearingLineDistanceInput,
    bearingLineDistanceKm,
    bearingLineUnit,
    measurementMode,
    measurementPoints,
    onToggleAnnotations: toggleAnnotations,
    onClearAnnotations: clearAnnotations,
    onUpdateAnnotationLabel: updateAnnotationLabel,
    onRemoveAnnotation: removeAnnotation,
    onToggleRangeRings: toggleRangeRings,
    onClearRangeRings: clearRangeRings,
    onUpdateRangeRingInput: updateRangeRingInput,
    onSetRangeRingUnit: setRangeRingDisplayUnit,
    onToggleSector: toggleSector,
    onClearSector: clearSector,
    onUpdateSectorDegreesInput: updateSectorDegreesInput,
    onUpdateSectorArcInput: updateSectorArcInput,
    onUpdateSectorDistanceInput: updateSectorDistanceInput,
    onSetSectorUnit: setSectorDisplayUnit,
    onToggleBearingLine: toggleBearingLine,
    onClearBearingLine: clearBearingLine,
    onUpdateBearingLineDegreesInput: updateBearingLineDegreesInput,
    onUpdateBearingLineDistanceInput: updateBearingLineDistanceInput,
    onSetBearingLineUnit: setBearingLineDisplayUnit,
    onToggleMeasurement: toggleMeasurement,
    onClearMeasurement: clearMeasurement,
  })

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

  const overlayControlsProps = buildOverlayControlsProps({
    error,
    loading,
    pulseCount: replayPulses.length,
    signalError,
    telemetryConnected,
  })

  const {
    clearSelection,
    evidenceSignalIds,
    evidenceSiteIds,
    handleTransitioned,
    hasSelection,
    onAssetClick,
    onSignalClick,
    onSiteClick,
    readiness,
    selectedAsset,
    selectedAssetId,
    selectedLiveReading,
    selectedSignal,
    selectedSignalId,
    selectedSite,
    selectedSiteId,
    selectedTasks,
    selectedVessel,
    setSelectedAssetId,
    setSelectedSignalId,
    setSelectedSiteId,
    tasksBySite,
    urlSelectionAppliedRef,
    vesselTracks,
  } = useMapSelectionOrchestration({
    allTasks,
    assets,
    assetsLoaded,
    asOf,
    isReplaying,
    readings,
    signalError,
    signals,
    signalsConnected,
    sites,
    sitesLoaded,
  })

  const { mapLoaded, engineError, retryEngine, resize } = useMapEngineOrchestration({
    containerRef: mapContainerRef,
    location,
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
    signalCount: signals.length,
    signalsConnected,
    telemetryConnected,
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

  const selectionPanelsProps: MapSelectionPanelsProps = {
    selectedSite,
    selectedTasks,
    readiness,
    riskBySiteId,
    role,
    canTriage: canTriageAlerts,
    referenceTimeMs,
    selectedAsset,
    selectedLiveReading,
    selectedSignal,
    selectedVessel,
    vesselTracks,
    isReplaying,
    onSelectSite: onSiteClick,
    onSelectSignal: onSignalClick,
    onTransitioned: handleTransitioned,
    onCloseSite: closePanel,
    onCloseAsset: closePanel,
    onCloseSignal: closePanel,
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className={`map-page${contextPanelOpen ? ' map-page--panel-open' : ''}`}>
      <MapViewportSurface
        engineError={engineError}
        mapContainerRef={mapContainerRef}
        overlayControlsProps={overlayControlsProps}
        retryEngine={retryEngine}
      />
      <MapContextPanelSurface
        contextPanelOpen={contextPanelOpen}
        handleResizeStart={handleResizeStart}
        hasSelection={hasSelection}
        panelRef={panelRef}
        panelWidth={panelWidth}
        selectionPanelsProps={selectionPanelsProps}
      />
    </div>
  )
}
