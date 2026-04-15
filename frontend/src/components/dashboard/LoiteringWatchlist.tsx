import { Icon, Tag } from '@blueprintjs/core'
import type { Vessel } from '../../api/vessels'

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtLoiteringDuration(iso: string | null, referenceTimeMs: number): string {
  if (!iso) return '—'

  const minutes = Math.max(1, Math.round((referenceTimeMs - Date.parse(iso)) / 60_000))
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`
}

export default function LoiteringWatchlist({
  vessels,
  referenceTimeMs,
}: {
  vessels: Vessel[]
  referenceTimeMs: number
}) {
  if (vessels.length === 0) {
    return (
      <p className="bp6-text-muted" style={{ fontSize: 12, margin: 0 }}>
        No vessels are currently flagged as loitering.
      </p>
    )
  }

  return (
    <div className="alerts-list">
      {vessels.map(vessel => (
        <div key={vessel.id} className="alert-row alert-row--warning">
          <div className="alert-row-main" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="alert-row-left">
              <span className="alert-signal-icon">
                <Icon icon="satellite" size={14} />
              </span>
              <div className="alert-body">
                <span className="alert-rule-name">{vessel.name ?? vessel.mmsi}</span>
                <span className="alert-site bp6-text-muted">
                  {vessel.mmsi}
                  {vessel.flag ? ` · ${vessel.flag}` : ''}
                  {vessel.vessel_type ? ` · ${vessel.vessel_type}` : ''}
                </span>
              </div>
            </div>
            <div className="alert-row-right">
              <div className="alert-actions" style={{ alignItems: 'flex-end' }}>
                <Tag minimal intent="warning" style={{ fontSize: 10, fontWeight: 600 }}>
                  Loitering {fmtLoiteringDuration(vessel.loitering_since, referenceTimeMs)}
                </Tag>
                {vessel.dark && (
                  <Tag minimal intent="danger" style={{ fontSize: 10, fontWeight: 600 }}>
                    Dark
                  </Tag>
                )}
              </div>
              <span className="bp6-text-muted" style={{ fontSize: 11 }}>
                Last seen {fmtTime(vessel.last_seen_at)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
