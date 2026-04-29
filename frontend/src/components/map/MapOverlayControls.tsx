import type { MapStyleKey } from '../../hooks/useMapLibreEngine'
import type { RangeRingUnit } from '../../lib/mapRangeRings'
import type { MapPoint } from '../../lib/mapPoint'
import type { MapAnnotation } from '../../lib/mapAnnotations'

import { StatusOverlays } from './overlay-controls/StatusOverlays'
import { TelemetryBadge } from './overlay-controls/TelemetryBadge'
import { StyleSwitcher } from './overlay-controls/StyleSwitcher'
import { LayerToggles } from './overlay-controls/LayerToggles'
import { ToolToggleStrip } from './overlay-controls/ToolToggleStrip'
import { AnnotatePanel } from './overlay-controls/AnnotatePanel'
import { RangeRingPanel } from './overlay-controls/RangeRingPanel'
import { SectorPanel } from './overlay-controls/SectorPanel'
import { BearingLinePanel } from './overlay-controls/BearingLinePanel'
import { MeasurementPanel } from './overlay-controls/MeasurementPanel'

interface MapOverlayControlsProps {
  loading: boolean
  error: string | null
  isReplaying: boolean
  telemetryConnected: boolean
  signalError: Error | null
  mapStyle: MapStyleKey
  showCoverage: boolean
  showChokepoints: boolean
  showTrails: boolean
  trailWindowMinutes: number
  showSignals: boolean
  showHeatmap: boolean
  showReplayPulses: boolean
  pulseCount: number
  annotationMode: boolean
  annotations: MapAnnotation[]
  rangeRingMode: boolean
  rangeRingAnchor: MapPoint | null
  rangeRingInputs: string[]
  rangeRingRadiiKm: number[]
  rangeRingUnit: RangeRingUnit
  sectorMode: boolean
  sectorAnchor: MapPoint | null
  sectorDegreesInput: string
  sectorDegrees: number | null
  sectorArcInput: string
  sectorArcDegrees: number | null
  sectorDistanceInput: string
  sectorDistanceKm: number | null
  sectorUnit: RangeRingUnit
  bearingLineMode: boolean
  bearingLineAnchor: MapPoint | null
  bearingLineDegreesInput: string
  bearingLineDegrees: number | null
  bearingLineDistanceInput: string
  bearingLineDistanceKm: number | null
  bearingLineUnit: RangeRingUnit
  measurementMode: boolean
  measurementPoints: MapPoint[]
  onMapStyleChange: (style: MapStyleKey) => void
  onToggleCoverage: () => void
  onToggleChokepoints: () => void
  onToggleTrails: () => void
  onTrailWindowChange: (minutes: number) => void
  onToggleSignals: () => void
  onToggleHeatmap: () => void
  onToggleReplayPulses: () => void
  onToggleAnnotations: () => void
  onClearAnnotations: () => void
  onUpdateAnnotationLabel: (annotationId: string, label: string) => void
  onRemoveAnnotation: (annotationId: string) => void
  onToggleRangeRings: () => void
  onClearRangeRings: () => void
  onUpdateRangeRingInput: (index: number, value: string) => void
  onSetRangeRingUnit: (unit: RangeRingUnit) => void
  onToggleSector: () => void
  onClearSector: () => void
  onUpdateSectorDegreesInput: (value: string) => void
  onUpdateSectorArcInput: (value: string) => void
  onUpdateSectorDistanceInput: (value: string) => void
  onSetSectorUnit: (unit: RangeRingUnit) => void
  onToggleBearingLine: () => void
  onClearBearingLine: () => void
  onUpdateBearingLineDegreesInput: (value: string) => void
  onUpdateBearingLineDistanceInput: (value: string) => void
  onSetBearingLineUnit: (unit: RangeRingUnit) => void
  onToggleMeasurement: () => void
  onClearMeasurement: () => void
}

export function MapOverlayControls(props: MapOverlayControlsProps) {
  return (
    <>
      <StatusOverlays
        loading={props.loading}
        error={props.error}
        isReplaying={props.isReplaying}
        showSignals={props.showSignals}
        signalError={props.signalError}
      />

      <TelemetryBadge
        isReplaying={props.isReplaying}
        telemetryConnected={props.telemetryConnected}
      />

      <StyleSwitcher
        mapStyle={props.mapStyle}
        onMapStyleChange={props.onMapStyleChange}
      />

      <LayerToggles
        isReplaying={props.isReplaying}
        showCoverage={props.showCoverage}
        showChokepoints={props.showChokepoints}
        showTrails={props.showTrails}
        trailWindowMinutes={props.trailWindowMinutes}
        showSignals={props.showSignals}
        showHeatmap={props.showHeatmap}
        showReplayPulses={props.showReplayPulses}
        pulseCount={props.pulseCount}
        onToggleCoverage={props.onToggleCoverage}
        onToggleChokepoints={props.onToggleChokepoints}
        onToggleTrails={props.onToggleTrails}
        onTrailWindowChange={props.onTrailWindowChange}
        onToggleSignals={props.onToggleSignals}
        onToggleHeatmap={props.onToggleHeatmap}
        onToggleReplayPulses={props.onToggleReplayPulses}
      />

      <div className="map-tool-overlay">
        <ToolToggleStrip
          annotationMode={props.annotationMode}
          rangeRingMode={props.rangeRingMode}
          sectorMode={props.sectorMode}
          bearingLineMode={props.bearingLineMode}
          measurementMode={props.measurementMode}
          onToggleAnnotations={props.onToggleAnnotations}
          onToggleRangeRings={props.onToggleRangeRings}
          onToggleSector={props.onToggleSector}
          onToggleBearingLine={props.onToggleBearingLine}
          onToggleMeasurement={props.onToggleMeasurement}
        />

        {props.annotationMode && (
          <AnnotatePanel
            annotations={props.annotations}
            onClearAnnotations={props.onClearAnnotations}
            onUpdateAnnotationLabel={props.onUpdateAnnotationLabel}
            onRemoveAnnotation={props.onRemoveAnnotation}
          />
        )}

        {props.rangeRingMode && (
          <RangeRingPanel
            rangeRingAnchor={props.rangeRingAnchor}
            rangeRingInputs={props.rangeRingInputs}
            rangeRingRadiiKm={props.rangeRingRadiiKm}
            rangeRingUnit={props.rangeRingUnit}
            onClearRangeRings={props.onClearRangeRings}
            onUpdateRangeRingInput={props.onUpdateRangeRingInput}
            onSetRangeRingUnit={props.onSetRangeRingUnit}
          />
        )}

        {props.sectorMode && (
          <SectorPanel
            sectorAnchor={props.sectorAnchor}
            sectorDegreesInput={props.sectorDegreesInput}
            sectorDegrees={props.sectorDegrees}
            sectorArcInput={props.sectorArcInput}
            sectorArcDegrees={props.sectorArcDegrees}
            sectorDistanceInput={props.sectorDistanceInput}
            sectorDistanceKm={props.sectorDistanceKm}
            sectorUnit={props.sectorUnit}
            onClearSector={props.onClearSector}
            onUpdateSectorDegreesInput={props.onUpdateSectorDegreesInput}
            onUpdateSectorArcInput={props.onUpdateSectorArcInput}
            onUpdateSectorDistanceInput={props.onUpdateSectorDistanceInput}
            onSetSectorUnit={props.onSetSectorUnit}
          />
        )}

        {props.bearingLineMode && (
          <BearingLinePanel
            bearingLineAnchor={props.bearingLineAnchor}
            bearingLineDegreesInput={props.bearingLineDegreesInput}
            bearingLineDegrees={props.bearingLineDegrees}
            bearingLineDistanceInput={props.bearingLineDistanceInput}
            bearingLineDistanceKm={props.bearingLineDistanceKm}
            bearingLineUnit={props.bearingLineUnit}
            onClearBearingLine={props.onClearBearingLine}
            onUpdateBearingLineDegreesInput={props.onUpdateBearingLineDegreesInput}
            onUpdateBearingLineDistanceInput={props.onUpdateBearingLineDistanceInput}
            onSetBearingLineUnit={props.onSetBearingLineUnit}
          />
        )}

        {props.measurementMode && (
          <MeasurementPanel
            measurementPoints={props.measurementPoints}
            onClearMeasurement={props.onClearMeasurement}
          />
        )}
      </div>
    </>
  )
}
