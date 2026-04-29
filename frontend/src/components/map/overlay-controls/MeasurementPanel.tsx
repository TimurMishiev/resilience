import type { MapPoint } from '../../../lib/mapPoint'
import { formatPoint, computeMeasurementSummary } from './derivations'

interface MeasurementPanelProps {
  measurementPoints: MapPoint[]
  onClearMeasurement: () => void
}

export function MeasurementPanel({ measurementPoints, onClearMeasurement }: MeasurementPanelProps) {
  const { anchor, target, distanceKm, distanceNm, bearingDegrees, bearingLabel } =
    computeMeasurementSummary(measurementPoints)

  return (
    <div className="map-measure-panel" data-testid="map-measure-panel">
      <div className="map-measure-panel-header">
        <span className="map-measure-panel-title">MEASUREMENT TOOL</span>
        <button
          type="button"
          className="map-measure-panel-action"
          onClick={onClearMeasurement}
          disabled={measurementPoints.length === 0}
        >
          Clear
        </button>
      </div>

      {measurementPoints.length === 0 && (
        <div className="map-measure-panel-body">
          <p className="map-measure-panel-hint">
            Click an anchor point on the map. While measurement mode is active, map clicks capture distance and bearing instead of selection.
          </p>
        </div>
      )}

      {measurementPoints.length === 1 && anchor && (
        <div className="map-measure-panel-body">
          <p className="map-measure-panel-hint">
            Anchor locked. Click a second point to complete the measurement.
          </p>
          <div className="map-measure-panel-row">
            <span className="map-measure-panel-label">A</span>
            <span className="map-measure-panel-value mono">{formatPoint(anchor)}</span>
          </div>
        </div>
      )}

      {measurementPoints.length >= 2 && anchor && target && distanceKm !== null && distanceNm !== null && bearingDegrees !== null && bearingLabel !== null && (
        <div className="map-measure-panel-body">
          <div className="map-measure-panel-row">
            <span className="map-measure-panel-label">A</span>
            <span className="map-measure-panel-value mono">{formatPoint(anchor)}</span>
          </div>
          <div className="map-measure-panel-row">
            <span className="map-measure-panel-label">B</span>
            <span className="map-measure-panel-value mono">{formatPoint(target)}</span>
          </div>
          <div className="map-measure-panel-metrics">
            <div className="map-measure-panel-metric">
              <span className="map-measure-panel-metric-label">Distance</span>
              <span className="map-measure-panel-metric-value">{distanceKm.toFixed(1)} km · {distanceNm.toFixed(1)} nm</span>
            </div>
            <div className="map-measure-panel-metric">
              <span className="map-measure-panel-metric-label">Bearing</span>
              <span className="map-measure-panel-metric-value">{bearingDegrees.toFixed(0).padStart(3, '0')}° {bearingLabel}</span>
            </div>
          </div>
          <p className="map-measure-panel-hint">
            The next map click starts a new measurement from a fresh anchor.
          </p>
        </div>
      )}
    </div>
  )
}
