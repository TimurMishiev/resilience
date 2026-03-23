import { Callout, Spinner, Tag } from '@blueprintjs/core'
import { useAuditEvents } from '../hooks/useAuditEvents'
import type { AuditEvent } from '../api/types'
import { humanize } from '../utils/humanize'

interface Props {
  entityType: string
  entityId: string
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function changedKeys(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): string[] {
  if (!before) return []
  return Object.keys(after).filter(
    (k) =>
      k !== 'updated_at' &&
      JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  )
}

function eventLabel(event: AuditEvent): string {
  if (event.action) return humanize(event.action)
  return humanize(event.event_type)
}

export default function AuditTimeline({ entityType, entityId }: Props) {
  const { data: events, error, isPending } = useAuditEvents({
    entity_type: entityType,
    entity_id: entityId,
    limit: 50,
  })

  if (isPending) return <Spinner size={16} />

  if (error) {
    return <Callout intent="danger" compact>{error.message}</Callout>
  }

  if (!events || events.length === 0) {
    return <p className="bp6-text-muted timeline-empty">No audit events recorded.</p>
  }

  return (
    <ol className="timeline">
      {events.map((event) => {
        const changed = changedKeys(event.before_snapshot, event.after_snapshot)
        return (
          <li key={event.id} className="timeline-item">
            <div className="timeline-meta">
              <span className="timeline-time bp6-text-muted">{formatTime(event.occurred_at)}</span>
              <span className="timeline-actor bp6-text-muted">{event.actor}</span>
            </div>
            <div className="timeline-body">
              <Tag minimal className="timeline-label">{eventLabel(event)}</Tag>
              {changed.length > 0 && (
                <span className="timeline-changed bp6-text-muted">
                  {changed.join(', ')}
                </span>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
