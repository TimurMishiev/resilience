import type { MapPoint } from '../../../lib/mapPoint'
import type { RangeRingUnit } from '../../../lib/mapRangeRings'
import { formatPoint, computeBearingLineSummary } from './derivations'

interface BearingLinePanelProps {
  bearingLineAnchor: MapPoint | null
  bearingLineDegreesInput: string
  bearingLineDegrees: number | null
  bearingLineDistanceInput: string
  bearingLineDistanceKm: number | null
  bearingLineUnit: RangeRingUnit
  onClearBearingLine: () => void
  onUpdateBearingLineDegreesInput: (value: string) => void
  onUpdateBearingLineDistanceInput: (value: string) => void
  onSetBearingLineUnit: (unit: RangeRingUnit) => void
}

export function BearingLinePanel({
  bearingLineAnchor,
  bearingLineDegreesInput,
  bearingLineDegrees,
  bearingLineDistanceInput,
  bearingLineDistanceKm,
  bearingLineUnit,
  onClearBearingLine,
  onUpdateBearingLineDegreesInput,
  onUpdateBearingLineDistanceInput,
  onSetBearingLineUnit,
}: BearingLinePanelProps) {
  const { heading, cardinal, distanceLabel } = computeBearingLineSummary(
    bearingLineDegrees,
    bearingLineDistanceKm,
    bearingLineUnit,
  )

  return (
    <div className="map-bearing-panel" data-testid="map-bearing-panel">
      <div className="map-bearing-panel-header">
        <span className="map-bearing-panel-title">BEARING LINE</span>
        <button
          type="button"
          className="map-bearing-panel-action"
          onClick={onClearBearingLine}
          disabled={!bearingLineAnchor}
        >
          Clear
        </button>
      </div>

      <div className="map-bearing-panel-body">
        <p className="map-bearing-panel-hint">
          Click the map to place or reposition a session-local anchor. Bearing lines stay on this client only and do not change selection or route state.
        </p>

        <div className="map-bearing-panel-units" role="group" aria-label="Bearing line units">
          {(['nm', 'km'] as const).map(unit => (
            <button
              key={unit}
              type="button"
              className={`map-bearing-panel-unit-btn${bearingLineUnit === unit ? ' map-bearing-panel-unit-btn--active' : ''}`}
              onClick={() => onSetBearingLineUnit(unit)}
              aria-pressed={bearingLineUnit === unit}
            >
              {unit.toUpperCase()}
            </button>
          ))}
        </div>

        {bearingLineAnchor ? (
          <div className="map-bearing-panel-row">
            <span className="map-bearing-panel-label">Anchor</span>
            <span className="map-bearing-panel-value mono">{formatPoint(bearingLineAnchor)}</span>
          </div>
        ) : (
          <p className="map-bearing-panel-hint">No bearing anchor yet.</p>
        )}

        <label className="map-bearing-panel-item">
          <span className="map-bearing-panel-label">Bearing</span>
          <div className="map-bearing-panel-input-row">
            <input
              type="number"
              min="0"
              max="360"
              step="1"
              className="map-bearing-panel-input"
              aria-label="Bearing degrees"
              value={bearingLineDegreesInput}
              onChange={event => onUpdateBearingLineDegreesInput(event.target.value)}
            />
            <span className="map-bearing-panel-unit-label">DEG</span>
          </div>
        </label>

        <label className="map-bearing-panel-item">
          <span className="map-bearing-panel-label">Extent</span>
          <div className="map-bearing-panel-input-row">
            <input
              type="number"
              min="0.1"
              step={bearingLineUnit === 'nm' ? '0.5' : '1'}
              className="map-bearing-panel-input"
              aria-label="Bearing line extent"
              value={bearingLineDistanceInput}
              onChange={event => onUpdateBearingLineDistanceInput(event.target.value)}
            />
            <span className="map-bearing-panel-unit-label">{bearingLineUnit.toUpperCase()}</span>
          </div>
        </label>

        {bearingLineAnchor && heading !== null && cardinal !== null && distanceLabel !== null && (
          <div className="map-bearing-panel-summary">
            <div className="map-bearing-panel-row">
              <span className="map-bearing-panel-label">Heading</span>
              <span className="map-bearing-panel-value">{heading} {cardinal}</span>
            </div>
            <div className="map-bearing-panel-row">
              <span className="map-bearing-panel-label">Extent</span>
              <span className="map-bearing-panel-value">{distanceLabel}</span>
            </div>
          </div>
        )}

        {bearingLineAnchor && (heading === null || distanceLabel === null) && (
          <p className="map-bearing-panel-hint">Enter a bearing between 0 and 360 degrees and a positive extent to render the line.</p>
        )}

        {bearingLineAnchor && heading !== null && distanceLabel !== null && (
          <p className="map-bearing-panel-hint">
            Showing {heading} for {distanceLabel}. The next map click repositions the anchor.
          </p>
        )}
      </div>
    </div>
  )
}
