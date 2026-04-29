import type { MapPoint } from '../../../lib/mapPoint'
import type { RangeRingUnit } from '../../../lib/mapRangeRings'
import { formatPoint, computeSectorSummary } from './derivations'

interface SectorPanelProps {
  sectorAnchor: MapPoint | null
  sectorDegreesInput: string
  sectorDegrees: number | null
  sectorArcInput: string
  sectorArcDegrees: number | null
  sectorDistanceInput: string
  sectorDistanceKm: number | null
  sectorUnit: RangeRingUnit
  onClearSector: () => void
  onUpdateSectorDegreesInput: (value: string) => void
  onUpdateSectorArcInput: (value: string) => void
  onUpdateSectorDistanceInput: (value: string) => void
  onSetSectorUnit: (unit: RangeRingUnit) => void
}

export function SectorPanel({
  sectorAnchor,
  sectorDegreesInput,
  sectorDegrees,
  sectorArcInput,
  sectorArcDegrees,
  sectorDistanceInput,
  sectorDistanceKm,
  sectorUnit,
  onClearSector,
  onUpdateSectorDegreesInput,
  onUpdateSectorArcInput,
  onUpdateSectorDistanceInput,
  onSetSectorUnit,
}: SectorPanelProps) {
  const { heading, cardinal, arcLabel, distanceLabel } = computeSectorSummary(
    sectorDegrees,
    sectorArcDegrees,
    sectorDistanceKm,
    sectorUnit,
  )

  return (
    <div className="map-sector-panel" data-testid="map-sector-panel">
      <div className="map-sector-panel-header">
        <span className="map-sector-panel-title">SECTOR OVERLAY</span>
        <button
          type="button"
          className="map-sector-panel-action"
          onClick={onClearSector}
          disabled={!sectorAnchor}
        >
          Clear
        </button>
      </div>

      <div className="map-sector-panel-body">
        <p className="map-sector-panel-hint">
          Click the map to place or reposition a session-local anchor. Sectors stay on this client only and do not change selection or route state.
        </p>

        <div className="map-sector-panel-units" role="group" aria-label="Sector units">
          {(['nm', 'km'] as const).map(unit => (
            <button
              key={unit}
              type="button"
              className={`map-sector-panel-unit-btn${sectorUnit === unit ? ' map-sector-panel-unit-btn--active' : ''}`}
              onClick={() => onSetSectorUnit(unit)}
              aria-pressed={sectorUnit === unit}
            >
              {unit.toUpperCase()}
            </button>
          ))}
        </div>

        {sectorAnchor ? (
          <div className="map-sector-panel-row">
            <span className="map-sector-panel-label">Anchor</span>
            <span className="map-sector-panel-value mono">{formatPoint(sectorAnchor)}</span>
          </div>
        ) : (
          <p className="map-sector-panel-hint">No sector anchor yet.</p>
        )}

        <label className="map-sector-panel-item">
          <span className="map-sector-panel-label">Bearing</span>
          <div className="map-sector-panel-input-row">
            <input
              type="number"
              min="0"
              max="360"
              step="1"
              className="map-sector-panel-input"
              aria-label="Sector bearing degrees"
              value={sectorDegreesInput}
              onChange={event => onUpdateSectorDegreesInput(event.target.value)}
            />
            <span className="map-sector-panel-unit-label">DEG</span>
          </div>
        </label>

        <label className="map-sector-panel-item">
          <span className="map-sector-panel-label">Arc</span>
          <div className="map-sector-panel-input-row">
            <input
              type="number"
              min="1"
              max="180"
              step="1"
              className="map-sector-panel-input"
              aria-label="Sector arc degrees"
              value={sectorArcInput}
              onChange={event => onUpdateSectorArcInput(event.target.value)}
            />
            <span className="map-sector-panel-unit-label">DEG</span>
          </div>
        </label>

        <label className="map-sector-panel-item">
          <span className="map-sector-panel-label">Extent</span>
          <div className="map-sector-panel-input-row">
            <input
              type="number"
              min="0.1"
              step={sectorUnit === 'nm' ? '0.5' : '1'}
              className="map-sector-panel-input"
              aria-label="Sector extent"
              value={sectorDistanceInput}
              onChange={event => onUpdateSectorDistanceInput(event.target.value)}
            />
            <span className="map-sector-panel-unit-label">{sectorUnit.toUpperCase()}</span>
          </div>
        </label>

        {sectorAnchor && heading !== null && cardinal !== null && arcLabel !== null && distanceLabel !== null && (
          <div className="map-sector-panel-summary">
            <div className="map-sector-panel-row">
              <span className="map-sector-panel-label">Heading</span>
              <span className="map-sector-panel-value">{heading} {cardinal}</span>
            </div>
            <div className="map-sector-panel-row">
              <span className="map-sector-panel-label">Spread</span>
              <span className="map-sector-panel-value">{arcLabel}</span>
            </div>
            <div className="map-sector-panel-row">
              <span className="map-sector-panel-label">Extent</span>
              <span className="map-sector-panel-value">{distanceLabel}</span>
            </div>
          </div>
        )}

        {sectorAnchor && (heading === null || arcLabel === null || distanceLabel === null) && (
          <p className="map-sector-panel-hint">Enter a bearing between 0 and 360 degrees, an arc between 1 and 180 degrees, and a positive extent to render the sector.</p>
        )}

        {sectorAnchor && heading !== null && arcLabel !== null && distanceLabel !== null && (
          <p className="map-sector-panel-hint">
            Showing {heading} with {arcLabel} for {distanceLabel}. The next map click repositions the anchor.
          </p>
        )}
      </div>
    </div>
  )
}
