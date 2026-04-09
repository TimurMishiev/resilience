import { SIGNAL_COLORS, SIGNAL_LABELS } from '../../lib/signalConfig'

interface GlobeLegendProps {
  showCoverage:    boolean
  showSignals:     boolean
  showHeatmap:     boolean
  showChokepoints: boolean
}

export function GlobeLegend({
  showCoverage, showSignals, showHeatmap, showChokepoints,
}: GlobeLegendProps) {
  return (
    <div className="globe-legend bp6-dark">
      <div className="globe-legend-section-title">SITES</div>
      <div className="globe-legend-item">
        <span className="globe-legend-dot" style={{ background: '#ff4444' }} />Blocked
      </div>
      <div className="globe-legend-item">
        <span className="globe-legend-dot" style={{ background: '#32cd32' }} />Resolved
      </div>
      <div className="globe-legend-item">
        <span className="globe-legend-dot" style={{ background: '#1e90ff' }} />In progress
      </div>
      <div className="globe-legend-item">
        <span className="globe-legend-dot" style={{ background: '#00ffff' }} />Asset (live)
      </div>
      {showChokepoints && (
        <>
          <div className="globe-legend-section-title" style={{ marginTop: 10 }}>CHOKEPOINTS</div>
          <div className="globe-legend-item">
            <span className="globe-legend-dot" style={{ background: '#ffd43b' }} />Monitor
          </div>
          <div className="globe-legend-item">
            <span className="globe-legend-dot" style={{ background: '#ff922b' }} />Constrained
          </div>
          <div className="globe-legend-item">
            <span className="globe-legend-dot" style={{ background: '#fa5252' }} />Contested
          </div>
          <div className="globe-legend-item">
            <span className="globe-legend-dot" style={{ background: '#868e96' }} />Closed
          </div>
        </>
      )}
      {showCoverage && (
        <>
          <div className="globe-legend-section-title" style={{ marginTop: 10 }}>COVERAGE</div>
          <div className="globe-legend-item">
            <span className="globe-legend-dot" style={{ background: '#3ddc84' }} />Available radius
          </div>
          <div className="globe-legend-item">
            <span className="globe-legend-dot" style={{ background: '#5282ff' }} />Assigned radius
          </div>
          <div className="globe-legend-item">
            <span className="globe-legend-dot" style={{ background: '#ffb366' }} />Degraded radius
          </div>
        </>
      )}
      {showSignals && (
        <>
          <div className="globe-legend-section-title" style={{ marginTop: 10 }}>SIGNALS</div>
          {Object.entries(SIGNAL_LABELS).map(([type, label]) => (
            <div key={type} className="globe-legend-item">
              <span className="globe-legend-dot" style={{ background: SIGNAL_COLORS[type] ?? '#ffffff' }} />
              {label}
            </div>
          ))}
        </>
      )}
      {showSignals && showHeatmap && (
        <>
          <div className="globe-legend-section-title" style={{ marginTop: 10 }}>HEATMAP</div>
          <div className="globe-heatmap-legend-bar" />
          <div className="globe-heatmap-legend-labels">
            <span>LOW DENSITY</span>
            <span>HIGH DENSITY</span>
          </div>
        </>
      )}
    </div>
  )
}
