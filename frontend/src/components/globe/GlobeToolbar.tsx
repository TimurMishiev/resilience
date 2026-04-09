import { Button } from '@blueprintjs/core'

interface GlobeToolbarProps {
  showSignals:        boolean
  showHeatmap:        boolean
  showCoverage:       boolean
  showChokepoints:    boolean
  showTrails:         boolean
  trailWindowMinutes: number
  isReplaying:        boolean
  isCloseView:        boolean
  signalError:        Error | null
  tacticalMapHref:    string
  onHome:              () => void
  onToggleSignals:     () => void
  onToggleHeatmap:     () => void
  onToggleCoverage:    () => void
  onToggleChokepoints: () => void
  onToggleTrails:      () => void
  onTrailWindowChange: (minutes: number) => void
  onTacticalMap:       () => void
}

export function GlobeToolbar({
  showSignals, showHeatmap, showCoverage, showChokepoints, showTrails, trailWindowMinutes,
  isReplaying, isCloseView, signalError,
  onHome, onToggleSignals, onToggleHeatmap, onToggleCoverage, onToggleChokepoints,
  onToggleTrails, onTrailWindowChange, onTacticalMap,
}: GlobeToolbarProps) {
  const hint = signalError && !isReplaying
    ? 'Live signal baseline sync is incomplete. Signals may be temporarily missing while the client retries.'
    : isReplaying
    ? 'Replay mode keeps historical AO overlays, chokepoint overlays, breach overlays, and AIS vessel context visible. Live-only vessel enrichments remain limited. Historical vessel trails remain visible up to the replay timestamp.'
    : isCloseView
    ? 'Signal overlays hidden at close range. Use the 2D map for tactical inspection.'
    : 'Click any site, asset, or signal to inspect it'

  return (
    <div className="globe-toolbar bp6-dark">
      <span className="globe-toolbar-title">3D GLOBE</span>
      <Button small minimal icon="home" title="Reset view" onClick={onHome} />
      <div
        className={`globe-signal-toggle${showSignals ? ' globe-signal-toggle--active' : ''}`}
        onClick={onToggleSignals}
        role="button"
      >
        SIGNALS {showSignals ? 'ON' : 'OFF'}
      </div>
      <div
        className={`globe-signal-toggle${showHeatmap ? ' globe-signal-toggle--active' : ''}`}
        onClick={onToggleHeatmap}
        role="button"
      >
        HEATMAP {showHeatmap ? 'ON' : 'OFF'}
      </div>
      <div
        className={`globe-signal-toggle${showCoverage ? ' globe-signal-toggle--active' : ''}`}
        onClick={onToggleCoverage}
        role="button"
      >
        COVERAGE {showCoverage ? 'ON' : 'OFF'}
      </div>
      <div
        className={`globe-signal-toggle${showChokepoints ? ' globe-signal-toggle--active' : ''}`}
        onClick={onToggleChokepoints}
        role="button"
      >
        CHOKEPOINTS {showChokepoints ? 'ON' : 'OFF'}
      </div>
      {isReplaying && (
        <>
          <div
            className={`globe-signal-toggle${showTrails ? ' globe-signal-toggle--active' : ''}`}
            onClick={onToggleTrails}
            role="button"
            aria-label="Toggle asset trails"
          >
            TRAILS {showTrails ? 'ON' : 'OFF'}
          </div>
          {showTrails && (
            <select
              className="globe-trail-window-select"
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
      <span className="globe-toolbar-hint bp6-text-muted">{hint}</span>
      {isCloseView && (
        <Button small icon="map" onClick={onTacticalMap}>
          Open Tactical Map
        </Button>
      )}
    </div>
  )
}
