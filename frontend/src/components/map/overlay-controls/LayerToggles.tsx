import { SIGNAL_COLORS, SIGNAL_LABELS } from '../../../lib/signalConfig'

interface LayerTogglesProps {
  isReplaying: boolean
  showCoverage: boolean
  showChokepoints: boolean
  showTrails: boolean
  trailWindowMinutes: number
  showSignals: boolean
  showHeatmap: boolean
  showReplayPulses: boolean
  pulseCount: number
  onToggleCoverage: () => void
  onToggleChokepoints: () => void
  onToggleTrails: () => void
  onTrailWindowChange: (minutes: number) => void
  onToggleSignals: () => void
  onToggleHeatmap: () => void
  onToggleReplayPulses: () => void
}

export function LayerToggles({
  isReplaying,
  showCoverage,
  showChokepoints,
  showTrails,
  trailWindowMinutes,
  showSignals,
  showHeatmap,
  showReplayPulses,
  pulseCount,
  onToggleCoverage,
  onToggleChokepoints,
  onToggleTrails,
  onTrailWindowChange,
  onToggleSignals,
  onToggleHeatmap,
  onToggleReplayPulses,
}: LayerTogglesProps) {
  return (
    <>
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
          <div
            className={`map-coverage-toggle${showReplayPulses ? ' map-coverage-toggle--active' : ''}`}
            onClick={onToggleReplayPulses}
            role="button"
            aria-label="Toggle replay event pulses"
            data-testid="map-replay-pulses-toggle"
            title="Pulse events near the replay cursor: site flags, incidents, task transitions, prosecutions"
          >
            <span className="map-coverage-toggle-dot" />
            PULSES {showReplayPulses ? 'ON' : 'OFF'}
            {showReplayPulses && pulseCount > 0 && (
              <span className="map-coverage-toggle-badge">{pulseCount}</span>
            )}
          </div>
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
    </>
  )
}
