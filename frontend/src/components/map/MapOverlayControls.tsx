import { Callout, Spinner } from '@blueprintjs/core'
import { MAP_STYLE_CONFIGS, type MapStyleKey } from '../../hooks/useMapLibreEngine'
import { SIGNAL_COLORS, SIGNAL_LABELS } from '../../lib/signalConfig'
import {
  measurementBearingCardinal,
  measurementBearingDegrees,
  measurementDistanceKm,
  type MapMeasurementPoint,
} from '../../lib/mapMeasurement'

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
  measurementMode: boolean
  measurementPoints: MapMeasurementPoint[]
  onMapStyleChange: (style: MapStyleKey) => void
  onToggleCoverage: () => void
  onToggleChokepoints: () => void
  onToggleTrails: () => void
  onTrailWindowChange: (minutes: number) => void
  onToggleSignals: () => void
  onToggleHeatmap: () => void
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
  measurementMode,
  measurementPoints,
  onMapStyleChange,
  onToggleCoverage,
  onToggleChokepoints,
  onToggleTrails,
  onTrailWindowChange,
  onToggleSignals,
  onToggleHeatmap,
  onToggleMeasurement,
  onClearMeasurement,
}: MapOverlayControlsProps) {
  const anchor = measurementPoints[0] ?? null
  const target = measurementPoints[1] ?? null
  const distanceKm = anchor && target ? measurementDistanceKm(anchor, target) : null
  const distanceNm = distanceKm === null ? null : distanceKm / 1.852
  const bearingDegrees = anchor && target ? measurementBearingDegrees(anchor, target) : null
  const bearingLabel = bearingDegrees === null ? null : measurementBearingCardinal(bearingDegrees)
  const formatPoint = (point: MapMeasurementPoint) => `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`

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

      <div
        className={`map-measure-toggle${measurementMode ? ' map-measure-toggle--active' : ''}`}
        onClick={onToggleMeasurement}
        role="button"
        aria-label="Toggle map measurement tool"
      >
        <span className="map-measure-toggle-dot" />
        MEASURE {measurementMode ? 'ON' : 'OFF'}
      </div>

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
    </>
  )
}
