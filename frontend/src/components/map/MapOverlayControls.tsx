import { Callout, Spinner } from '@blueprintjs/core'
import { MAP_STYLE_CONFIGS, type MapStyleKey } from '../../hooks/useMapLibreEngine'
import { SIGNAL_COLORS, SIGNAL_LABELS } from '../../lib/signalConfig'
import { formatBearingLineDegrees } from '../../lib/mapBearingLine'
import {
  measurementBearingCardinal,
  measurementBearingDegrees,
  measurementDistanceKm,
} from '../../lib/mapMeasurement'
import { formatRangeRingInputValue, type RangeRingUnit } from '../../lib/mapRangeRings'
import type { MapPoint } from '../../lib/mapPoint'
import type { MapAnnotation } from '../../lib/mapAnnotations'

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
  annotationMode: boolean
  annotations: MapAnnotation[]
  rangeRingMode: boolean
  rangeRingAnchor: MapPoint | null
  rangeRingInputs: string[]
  rangeRingRadiiKm: number[]
  rangeRingUnit: RangeRingUnit
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
  onToggleAnnotations: () => void
  onClearAnnotations: () => void
  onUpdateAnnotationLabel: (annotationId: string, label: string) => void
  onRemoveAnnotation: (annotationId: string) => void
  onToggleRangeRings: () => void
  onClearRangeRings: () => void
  onUpdateRangeRingInput: (index: number, value: string) => void
  onSetRangeRingUnit: (unit: RangeRingUnit) => void
  onToggleBearingLine: () => void
  onClearBearingLine: () => void
  onUpdateBearingLineDegreesInput: (value: string) => void
  onUpdateBearingLineDistanceInput: (value: string) => void
  onSetBearingLineUnit: (unit: RangeRingUnit) => void
  onToggleMeasurement: () => void
  onClearMeasurement: () => void
}

export function MapOverlayControls({
  loading,
  error,
  isReplaying,
  telemetryConnected,
  signalError,
  mapStyle,
  showCoverage,
  showChokepoints,
  showTrails,
  trailWindowMinutes,
  showSignals,
  showHeatmap,
  annotationMode,
  annotations,
  rangeRingMode,
  rangeRingAnchor,
  rangeRingInputs,
  rangeRingRadiiKm,
  rangeRingUnit,
  bearingLineMode,
  bearingLineAnchor,
  bearingLineDegreesInput,
  bearingLineDegrees,
  bearingLineDistanceInput,
  bearingLineDistanceKm,
  bearingLineUnit,
  measurementMode,
  measurementPoints,
  onMapStyleChange,
  onToggleCoverage,
  onToggleChokepoints,
  onToggleTrails,
  onTrailWindowChange,
  onToggleSignals,
  onToggleHeatmap,
  onToggleAnnotations,
  onClearAnnotations,
  onUpdateAnnotationLabel,
  onRemoveAnnotation,
  onToggleRangeRings,
  onClearRangeRings,
  onUpdateRangeRingInput,
  onSetRangeRingUnit,
  onToggleBearingLine,
  onClearBearingLine,
  onUpdateBearingLineDegreesInput,
  onUpdateBearingLineDistanceInput,
  onSetBearingLineUnit,
  onToggleMeasurement,
  onClearMeasurement,
}: MapOverlayControlsProps) {
  const anchor = measurementPoints[0] ?? null
  const target = measurementPoints[1] ?? null
  const distanceKm = anchor && target ? measurementDistanceKm(anchor, target) : null
  const distanceNm = distanceKm === null ? null : distanceKm / 1.852
  const bearingDegrees = anchor && target ? measurementBearingDegrees(anchor, target) : null
  const bearingLabel = bearingDegrees === null ? null : measurementBearingCardinal(bearingDegrees)
  const rangeRingCount = rangeRingRadiiKm.length
  const bearingLineHeading = bearingLineDegrees === null ? null : formatBearingLineDegrees(bearingLineDegrees)
  const bearingLineCardinal = bearingLineDegrees === null ? null : measurementBearingCardinal(bearingLineDegrees)
  const bearingLineDistanceLabel = bearingLineDistanceKm === null
    ? null
    : `${formatRangeRingInputValue(bearingLineDistanceKm, bearingLineUnit)} ${bearingLineUnit.toUpperCase()}`
  const formatPoint = (point: MapPoint) => `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`

  return (
    <>
      {loading && (
        <div className="map-overlay map-overlay--loading"><Spinner /></div>
      )}

      {error && (
        <div className="map-overlay map-overlay--error">
          <Callout intent="danger" title="Failed to load map data" compact>{error}</Callout>
        </div>
      )}

      {!isReplaying && (
        <div className={`map-telemetry-badge map-telemetry-badge--${telemetryConnected ? 'live' : 'offline'}`}>
          <span className="map-telemetry-dot" />
          {telemetryConnected ? 'TELEMETRY LIVE' : 'TELEMETRY OFFLINE'}
        </div>
      )}

      {isReplaying && (
        <div className="map-overlay map-overlay--error" style={{ top: 56, left: 16, right: 'auto', bottom: 'auto', maxWidth: 420 }}>
          <Callout intent="warning" title="Replay limitations" compact>
            Historical AO overlays, risk shading, chokepoint overlays, geofence breach rings, and AIS vessel context remain available during replay. Live-only vessel enrichments remain limited. Historical vessel trails stay available up to the replay timestamp.
          </Callout>
        </div>
      )}

      {!isReplaying && signalError && showSignals && (
        <div className="map-overlay map-overlay--error" style={{ top: 56, left: 16, right: 'auto', bottom: 'auto', maxWidth: 420 }}>
          <Callout intent="warning" title="Signal baseline sync degraded" compact>
            Live signal streaming is connected, but the baseline sync is incomplete. Signals may be temporarily missing while the client retries automatically.
          </Callout>
        </div>
      )}

      <div className="map-style-switcher">
        {(Object.keys(MAP_STYLE_CONFIGS) as MapStyleKey[]).map(key => (
          <button
            key={key}
            className={`map-style-btn${mapStyle === key ? ' map-style-btn--active' : ''}`}
            onClick={() => onMapStyleChange(key)}
          >
            {MAP_STYLE_CONFIGS[key].label}
          </button>
        ))}
      </div>

      {showCoverage && (
        <div className="map-coverage-legend">
          <div className="map-coverage-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(61,220,132,0.28)', borderColor: '#3ddc84' }} />
            Available footprint
          </div>
          <div className="map-coverage-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(82,130,255,0.24)', borderColor: '#5282ff' }} />
            Assigned footprint
          </div>
          <div className="map-coverage-legend-item">
            <span className="map-coverage-legend-swatch map-coverage-legend-swatch--dashed" style={{ background: 'rgba(255,179,102,0.18)', borderColor: '#ffb366' }} />
            Degraded footprint
          </div>
        </div>
      )}
      <div
        className={`map-coverage-toggle${showCoverage ? ' map-coverage-toggle--active' : ''}`}
        onClick={onToggleCoverage}
        role="button"
        aria-label="Toggle sensor coverage"
      >
        <span className="map-coverage-toggle-dot" />
        COVERAGE {showCoverage ? 'ON' : 'OFF'}
      </div>

      {showChokepoints && (
        <div className="map-chokepoint-legend">
          <div className="map-chokepoint-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(255,212,59,0.22)', borderColor: '#ffd43b' }} />
            Monitor
          </div>
          <div className="map-chokepoint-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(255,146,43,0.22)', borderColor: '#ff922b' }} />
            Constrained
          </div>
          <div className="map-chokepoint-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(250,82,82,0.20)', borderColor: '#fa5252' }} />
            Contested
          </div>
          <div className="map-chokepoint-legend-item">
            <span className="map-coverage-legend-swatch map-coverage-legend-swatch--dashed" style={{ background: 'rgba(134,142,150,0.18)', borderColor: '#868e96' }} />
            Closed
          </div>
        </div>
      )}
      <div
        className={`map-coverage-toggle${showChokepoints ? ' map-coverage-toggle--active' : ''}`}
        onClick={onToggleChokepoints}
        role="button"
        aria-label="Toggle chokepoint overlay"
      >
        <span className="map-coverage-toggle-dot" />
        CHOKEPOINTS {showChokepoints ? 'ON' : 'OFF'}
      </div>

      {isReplaying && showTrails && (
        <div className="map-coverage-legend">
          <div className="map-coverage-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(61,220,132,0.28)', borderColor: '#3ddc84' }} />
            Available
          </div>
          <div className="map-coverage-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(82,130,255,0.24)', borderColor: '#5282ff' }} />
            Assigned
          </div>
          <div className="map-coverage-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(255,179,102,0.18)', borderColor: '#ffb366' }} />
            Degraded
          </div>
          <div className="map-coverage-legend-item">
            <span className="map-coverage-legend-swatch" style={{ background: 'rgba(134,142,150,0.18)', borderColor: '#868e96' }} />
            Offline
          </div>
        </div>
      )}
      {isReplaying && (
        <>
          <div
            className={`map-coverage-toggle${showTrails ? ' map-coverage-toggle--active' : ''}`}
            onClick={onToggleTrails}
            role="button"
            aria-label="Toggle asset trails"
          >
            <span className="map-coverage-toggle-dot" />
            TRAILS {showTrails ? 'ON' : 'OFF'}
          </div>
          {showTrails && (
            <select
              className="map-trail-window-select"
              value={trailWindowMinutes}
              onChange={e => onTrailWindowChange(Number(e.target.value))}
              aria-label="Trail window"
              title="Trail history window"
            >
              <option value={30}>30 min</option>
              <option value={60}>60 min</option>
              <option value={120}>120 min</option>
            </select>
          )}
        </>
      )}

      {showSignals && (
        <div className="map-signal-legend">
          {Object.entries(SIGNAL_LABELS).map(([type, label]) => (
            <div key={type} className="map-signal-legend-item">
              <span className="map-signal-legend-dot" style={{ background: SIGNAL_COLORS[type] }} />
              {label}
            </div>
          ))}
        </div>
      )}
      {showSignals && showHeatmap && (
        <div className="map-heatmap-legend">
          <div className="map-heatmap-legend-bar" />
          <div className="map-heatmap-legend-labels">
            <span>LOW DENSITY</span>
            <span>HIGH DENSITY</span>
          </div>
        </div>
      )}
      <div
        className={`map-signal-toggle${showSignals ? ' map-signal-toggle--active' : ''}`}
        onClick={onToggleSignals}
        role="button"
        aria-label="Toggle signal layer"
      >
        <span className="map-signal-toggle-dot" />
        SIGNALS {showSignals ? 'ON' : 'OFF'}
      </div>
      <div
        className={`map-heatmap-toggle${showHeatmap ? ' map-heatmap-toggle--active' : ''}`}
        onClick={onToggleHeatmap}
        role="button"
        aria-label="Toggle signal heatmap"
      >
        <span className="map-heatmap-toggle-dot" />
        HEATMAP {showHeatmap ? 'ON' : 'OFF'}
      </div>

      <div className="map-tool-overlay">
        <div className="map-tool-row">
          <div
            className={`map-annotate-toggle${annotationMode ? ' map-annotate-toggle--active' : ''}`}
            onClick={onToggleAnnotations}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onToggleAnnotations()
              }
            }}
            role="button"
            tabIndex={0}
            aria-pressed={annotationMode}
            aria-label="Toggle map annotation tool"
          >
            <span className="map-annotate-toggle-dot" />
            ANNOTATE {annotationMode ? 'ON' : 'OFF'}
          </div>

          <div
            className={`map-range-toggle${rangeRingMode ? ' map-range-toggle--active' : ''}`}
            onClick={onToggleRangeRings}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onToggleRangeRings()
              }
            }}
            role="button"
            tabIndex={0}
            aria-pressed={rangeRingMode}
            aria-label="Toggle map range ring tool"
          >
            <span className="map-range-toggle-dot" />
            RANGE {rangeRingMode ? 'ON' : 'OFF'}
          </div>

          <div
            className={`map-bearing-toggle${bearingLineMode ? ' map-bearing-toggle--active' : ''}`}
            onClick={onToggleBearingLine}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onToggleBearingLine()
              }
            }}
            role="button"
            tabIndex={0}
            aria-pressed={bearingLineMode}
            aria-label="Toggle map bearing line tool"
          >
            <span className="map-bearing-toggle-dot" />
            BEARING {bearingLineMode ? 'ON' : 'OFF'}
          </div>

          <div
            className={`map-measure-toggle${measurementMode ? ' map-measure-toggle--active' : ''}`}
            onClick={onToggleMeasurement}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onToggleMeasurement()
              }
            }}
            role="button"
            tabIndex={0}
            aria-pressed={measurementMode}
            aria-label="Toggle map measurement tool"
          >
            <span className="map-measure-toggle-dot" />
            MEASURE {measurementMode ? 'ON' : 'OFF'}
          </div>
        </div>

        {annotationMode && (
          <div className="map-annotate-panel" data-testid="map-annotate-panel">
            <div className="map-annotate-panel-header">
              <span className="map-annotate-panel-title">TEMPORARY ANNOTATIONS</span>
              <button
                type="button"
                className="map-annotate-panel-action"
                onClick={onClearAnnotations}
                disabled={annotations.length === 0}
              >
                Clear all
              </button>
            </div>

            <div className="map-annotate-panel-body">
              <p className="map-annotate-panel-hint">
                Click the map to drop session-local pins. Annotations stay on this client only and do not change selection or route state.
              </p>

              {annotations.length === 0 ? (
                <p className="map-annotate-panel-hint">No temporary annotations yet.</p>
              ) : (
                <div className="map-annotate-panel-list">
                  {annotations.map(annotation => (
                    <div key={annotation.id} className="map-annotate-panel-item">
                      <input
                        type="text"
                        className="map-annotate-panel-input"
                        aria-label="Annotation label"
                        maxLength={120}
                        value={annotation.label}
                        onChange={event => onUpdateAnnotationLabel(annotation.id, event.target.value)}
                      />
                      <div className="map-annotate-panel-coordinates mono">
                        {formatPoint(annotation)}
                      </div>
                      <button
                        type="button"
                        className="map-annotate-panel-action"
                        onClick={() => onRemoveAnnotation(annotation.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {rangeRingMode && (
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
        )}

        {bearingLineMode && (
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

              {bearingLineAnchor && bearingLineHeading !== null && bearingLineCardinal !== null && bearingLineDistanceLabel !== null && (
                <div className="map-bearing-panel-summary">
                  <div className="map-bearing-panel-row">
                    <span className="map-bearing-panel-label">Heading</span>
                    <span className="map-bearing-panel-value">{bearingLineHeading} {bearingLineCardinal}</span>
                  </div>
                  <div className="map-bearing-panel-row">
                    <span className="map-bearing-panel-label">Extent</span>
                    <span className="map-bearing-panel-value">{bearingLineDistanceLabel}</span>
                  </div>
                </div>
              )}

              {bearingLineAnchor && (bearingLineHeading === null || bearingLineDistanceLabel === null) && (
                <p className="map-bearing-panel-hint">Enter a bearing between 0 and 360 degrees and a positive extent to render the line.</p>
              )}

              {bearingLineAnchor && bearingLineHeading !== null && bearingLineDistanceLabel !== null && (
                <p className="map-bearing-panel-hint">
                  Showing {bearingLineHeading} for {bearingLineDistanceLabel}. The next map click repositions the anchor.
                </p>
              )}
            </div>
          </div>
        )}

        {measurementMode && (
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
        )}
      </div>
    </>
  )
}
