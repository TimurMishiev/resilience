interface TelemetryBadgeProps {
  isReplaying: boolean
  telemetryConnected: boolean
}

export function TelemetryBadge({ isReplaying, telemetryConnected }: TelemetryBadgeProps) {
  if (isReplaying) return null
  return (
    <div className={`map-telemetry-badge map-telemetry-badge--${telemetryConnected ? 'live' : 'offline'}`}>
      <span className="map-telemetry-dot" />
      {telemetryConnected ? 'TELEMETRY LIVE' : 'TELEMETRY OFFLINE'}
    </div>
  )
}
