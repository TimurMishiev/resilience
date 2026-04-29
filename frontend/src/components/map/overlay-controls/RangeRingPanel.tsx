import type { MapPoint } from '../../../lib/mapPoint'
import type { RangeRingUnit } from '../../../lib/mapRangeRings'
import { formatPoint } from './derivations'

interface RangeRingPanelProps {
  rangeRingAnchor: MapPoint | null
  rangeRingInputs: string[]
  rangeRingRadiiKm: number[]
  rangeRingUnit: RangeRingUnit
  onClearRangeRings: () => void
  onUpdateRangeRingInput: (index: number, value: string) => void
  onSetRangeRingUnit: (unit: RangeRingUnit) => void
}

export function RangeRingPanel({
  rangeRingAnchor,
  rangeRingInputs,
  rangeRingRadiiKm,
  rangeRingUnit,
  onClearRangeRings,
  onUpdateRangeRingInput,
  onSetRangeRingUnit,
}: RangeRingPanelProps) {
  const rangeRingCount = rangeRingRadiiKm.length

  return (
    <div className="map-range-panel" data-testid="map-range-panel">
      <div className="map-range-panel-header">
        <span className="map-range-panel-title">RANGE RINGS</span>
        <button
          type="button"
          className="map-range-panel-action"
          onClick={onClearRangeRings}
          disabled={!rangeRingAnchor}
        >
          Clear
        </button>
      </div>

      <div className="map-range-panel-body">
        <p className="map-range-panel-hint">
          Click the map to place or reposition a session-local anchor. Range rings stay on this client only and do not change selection or route state.
        </p>

        <div className="map-range-panel-units" role="group" aria-label="Range ring units">
          {(['nm', 'km'] as const).map(unit => (
            <button
              key={unit}
              type="button"
              className={`map-range-panel-unit-btn${rangeRingUnit === unit ? ' map-range-panel-unit-btn--active' : ''}`}
              onClick={() => onSetRangeRingUnit(unit)}
              aria-pressed={rangeRingUnit === unit}
            >
              {unit.toUpperCase()}
            </button>
          ))}
        </div>

        {rangeRingAnchor ? (
          <div className="map-range-panel-row">
            <span className="map-range-panel-label">Anchor</span>
            <span className="map-range-panel-value mono">{formatPoint(rangeRingAnchor)}</span>
          </div>
        ) : (
          <p className="map-range-panel-hint">No range anchor yet.</p>
        )}

        <div className="map-range-panel-list">
          {rangeRingInputs.map((inputValue, index) => (
            <label key={`range-ring-input-${index + 1}`} className="map-range-panel-item">
              <span className="map-range-panel-label">Ring {index + 1}</span>
              <div className="map-range-panel-input-row">
                <input
                  type="number"
                  min="0.1"
                  step={rangeRingUnit === 'nm' ? '0.5' : '1'}
                  className="map-range-panel-input"
                  aria-label={`Range ring ${index + 1} radius`}
                  value={inputValue}
                  onChange={event => onUpdateRangeRingInput(index, event.target.value)}
                />
                <span className="map-range-panel-unit-label">{rangeRingUnit.toUpperCase()}</span>
              </div>
            </label>
          ))}
        </div>

        {rangeRingAnchor && rangeRingCount === 0 && (
          <p className="map-range-panel-hint">Set at least one positive radius to render rings from the current anchor.</p>
        )}

        {rangeRingAnchor && rangeRingCount > 0 && (
          <p className="map-range-panel-hint">
            Showing {rangeRingCount} ring{rangeRingCount === 1 ? '' : 's'}. The next map click repositions the anchor.
          </p>
        )}
      </div>
    </div>
  )
}
