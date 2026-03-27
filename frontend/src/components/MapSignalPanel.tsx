import { Callout, Divider, Tag } from '@blueprintjs/core'
import { Icon } from '@blueprintjs/core'
import type { Signal } from '../api/types'
import type { Vessel, VesselTrack } from '../api/vessels'
import { formatTimestampFull } from '../lib/formatters'
import { humanize } from '../utils/humanize'
import { SIGNAL_COLORS, SIGNAL_LABELS, SOURCE_LABELS, ALERT_LEVEL_INTENT } from '../lib/signalConfig'
import { SIGNAL_ICON_NAME } from '../lib/signalIcons'

interface MapSignalPanelProps {
  signal: Signal
  vessel: Vessel | null
  vesselTracks: VesselTrack[]
  isReplaying: boolean
  onClose: () => void
}

export function MapSignalPanel({
  signal,
  vessel,
  vesselTracks,
  isReplaying,
  onClose,
}: MapSignalPanelProps) {
  const title = vessel?.name
    ? vessel.name
    : signal.signal_type === 'disaster_alert' && typeof signal.raw_payload.name === 'string'
      ? signal.raw_payload.name
      : signal.signal_type === 'conflict_event' && typeof signal.raw_payload.sub_event_type === 'string'
        ? signal.raw_payload.sub_event_type
        : (SIGNAL_LABELS[signal.signal_type] ?? signal.signal_type)

  return (
    <div className="map-panel bp6-dark">
      <div className="map-panel-header">
        <span className="map-panel-title">
          <Icon icon={SIGNAL_ICON_NAME[signal.signal_type] ?? 'dot'} size={14} style={{ marginRight: 6 }} />
          {title}
        </span>
        <button
          className="map-panel-close bp6-button bp6-minimal bp6-icon-cross"
          onClick={onClose}
          aria-label="Close"
        />
      </div>

      <div className="map-panel-tags">
        <Tag
          minimal
          style={{
            background: SIGNAL_COLORS[signal.signal_type] + '28',
            color:      SIGNAL_COLORS[signal.signal_type],
          }}
        >
          {humanize(signal.signal_type)}
        </Tag>
        <Tag minimal>{SOURCE_LABELS[signal.source] ?? signal.source}</Tag>
        {signal.signal_type === 'disaster_alert' &&
         typeof signal.raw_payload.alert_level === 'string' && (
          <Tag
            intent={ALERT_LEVEL_INTENT[signal.raw_payload.alert_level] ?? 'none'}
            minimal
          >
            {signal.raw_payload.alert_level}
          </Tag>
        )}
        {vessel?.loitering && (
          <Tag intent="warning" minimal>Loitering</Tag>
        )}
        {vessel?.dark && (
          <Tag intent="danger" minimal>Dark</Tag>
        )}
      </div>

      <p className="map-panel-coords bp6-text-muted">
        {Number(signal.lat).toFixed(4)}, {Number(signal.lng).toFixed(4)}
      </p>

      <Divider />

      {isReplaying && signal.signal_type === 'vessel_position' && (
        <>
          <Callout intent="warning" compact className="map-replay-notice">
            Vessel metadata and track history are unavailable in replay mode.
          </Callout>
          <Divider />
        </>
      )}

      <div className="map-telemetry-readings">
        {/* Vessel-specific identity fields */}
        {vessel && (
          <>
            {vessel.mmsi && (
              <div className="map-telemetry-row">
                <span className="map-telemetry-label">MMSI</span>
                <span className="map-telemetry-value">{vessel.mmsi}</span>
              </div>
            )}
            {vessel.vessel_type && (
              <div className="map-telemetry-row">
                <span className="map-telemetry-label">Type</span>
                <span className="map-telemetry-value">{vessel.vessel_type}</span>
              </div>
            )}
            {vessel.flag && (
              <div className="map-telemetry-row">
                <span className="map-telemetry-label">Flag</span>
                <span className="map-telemetry-value">{vessel.flag}</span>
              </div>
            )}
            {vessel.destination && (
              <div className="map-telemetry-row">
                <span className="map-telemetry-label">Destination</span>
                <span className="map-telemetry-value">{vessel.destination}</span>
              </div>
            )}
            {vessel.loitering_since && (
              <div className="map-telemetry-row">
                <span className="map-telemetry-label">Loitering since</span>
                <span className="map-telemetry-value bp6-text-muted">
                  {formatTimestampFull(Date.parse(vessel.loitering_since) / 1000)}
                </span>
              </div>
            )}
            {vesselTracks.length > 1 && (
              <div className="map-telemetry-row">
                <span className="map-telemetry-label">Track</span>
                <span className="map-telemetry-value bp6-text-muted">
                  {vesselTracks.length} pts · {new Date(vesselTracks[0].occurred_at).toLocaleDateString()}
                  {' – '}
                  {new Date(vesselTracks[vesselTracks.length - 1].occurred_at).toLocaleDateString()}
                </span>
              </div>
            )}
          </>
        )}

        {/* Conflict event detail */}
        {signal.signal_type === 'conflict_event' && (() => {
          const p = signal.raw_payload
          const eventType   = typeof p.event_type   === 'string' ? p.event_type   : null
          const country     = typeof p.country      === 'string' ? p.country      : null
          const actor1      = typeof p.actor1       === 'string' ? p.actor1       : null
          const actor2      = typeof p.actor2       === 'string' && p.actor2.length > 0 ? p.actor2 : null
          const fatalities  = typeof p.fatalities   === 'number' ? p.fatalities   : 0
          const notes       = typeof p.notes        === 'string' ? p.notes        : null
          return (
            <>
              {eventType && (
                <div className="map-telemetry-row">
                  <span className="map-telemetry-label">Event</span>
                  <span className="map-telemetry-value">{eventType}</span>
                </div>
              )}
              {country && (
                <div className="map-telemetry-row">
                  <span className="map-telemetry-label">Country</span>
                  <span className="map-telemetry-value">{country}</span>
                </div>
              )}
              {actor1 && (
                <div className="map-telemetry-row">
                  <span className="map-telemetry-label">Actor</span>
                  <span className="map-telemetry-value">{actor1}</span>
                </div>
              )}
              {actor2 && (
                <div className="map-telemetry-row">
                  <span className="map-telemetry-label">vs</span>
                  <span className="map-telemetry-value">{actor2}</span>
                </div>
              )}
              <div className="map-telemetry-row">
                <span className="map-telemetry-label">Fatalities</span>
                <span className="map-telemetry-value" style={fatalities > 0 ? { color: '#ff6b6b', fontWeight: 600 } : undefined}>
                  {fatalities}
                </span>
              </div>
              {notes && (
                <div className="map-telemetry-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                  <span className="map-telemetry-label">Notes</span>
                  <span className="map-telemetry-value bp6-text-muted" style={{ fontStyle: 'italic', fontSize: 11, whiteSpace: 'normal' }}>
                    {notes}
                  </span>
                </div>
              )}
            </>
          )
        })()}

        {/* Disaster alert detail */}
        {signal.signal_type === 'disaster_alert' && (() => {
          const p            = signal.raw_payload
          const typeName     = typeof p.event_type_name === 'string' ? p.event_type_name : null
          const country      = typeof p.country         === 'string' ? p.country         : null
          const severityText = typeof p.severity_text   === 'string' ? p.severity_text   : null
          return (
            <>
              {typeName && (
                <div className="map-telemetry-row">
                  <span className="map-telemetry-label">Type</span>
                  <span className="map-telemetry-value">{typeName}</span>
                </div>
              )}
              {country && (
                <div className="map-telemetry-row">
                  <span className="map-telemetry-label">Country</span>
                  <span className="map-telemetry-value">{country}</span>
                </div>
              )}
              {severityText && (
                <div className="map-telemetry-row">
                  <span className="map-telemetry-label">Severity</span>
                  <span className="map-telemetry-value">{severityText}</span>
                </div>
              )}
              {signal.magnitude != null && (
                <div className="map-telemetry-row">
                  <span className="map-telemetry-label">Impact score</span>
                  <span className="map-telemetry-value">
                    {Number(signal.magnitude).toFixed(1)} / 3.0
                  </span>
                </div>
              )}
            </>
          )
        })()}

        {/* Standard signal telemetry — suppressed for types with custom display above */}
        {signal.magnitude !== null && signal.magnitude !== undefined &&
         signal.signal_type !== 'conflict_event' &&
         signal.signal_type !== 'disaster_alert' && (
          <div className="map-telemetry-row">
            <span className="map-telemetry-label">Magnitude</span>
            <span className="map-telemetry-value">
              {Number(signal.magnitude).toFixed(1)}
            </span>
          </div>
        )}
        {signal.altitude !== null && signal.altitude !== undefined && (
          <div className="map-telemetry-row">
            <span className="map-telemetry-label">Altitude</span>
            <span className="map-telemetry-value">
              {Number(signal.altitude).toFixed(0)} m
            </span>
          </div>
        )}
        {signal.speed !== null && signal.speed !== undefined && (
          <div className="map-telemetry-row">
            <span className="map-telemetry-label">Speed</span>
            <span className="map-telemetry-value">
              {Number(signal.speed).toFixed(0)} kn
            </span>
          </div>
        )}
        {signal.heading !== null && signal.heading !== undefined && (
          <div className="map-telemetry-row">
            <span className="map-telemetry-label">Heading</span>
            <span className="map-telemetry-value">
              {Number(signal.heading).toFixed(0)}°
            </span>
          </div>
        )}
        <div className="map-telemetry-row">
          <span className="map-telemetry-label">Occurred</span>
          <span className="map-telemetry-value bp6-text-muted">
            {new Date(signal.occurred_at).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  )
}
