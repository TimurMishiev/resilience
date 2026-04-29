import { Callout, Spinner } from '@blueprintjs/core'

interface StatusOverlaysProps {
  loading: boolean
  error: string | null
  isReplaying: boolean
  showSignals: boolean
  signalError: Error | null
}

export function StatusOverlays({ loading, error, isReplaying, showSignals, signalError }: StatusOverlaysProps) {
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
    </>
  )
}
