import { useEffect, useState } from 'react'
import { Callout, Spinner, Tag } from '@blueprintjs/core'
import { getAuditEvents } from '../api/audit_events'
import type { AuditEvent } from '../api/types'

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
  if (event.action) return event.action.replace(/_/g, ' ')
  return event.event_type.replace(/_/g, ' ')
}

export default function AuditTimeline({ entityType, entityId }: Props) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getAuditEvents({ entity_type: entityType, entity_id: entityId, limit: 50 })
      .then(setEvents)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Unknown error'),
      )
      .finally(() => setLoading(false))
  }, [entityType, entityId])

  if (loading) return <Spinner size={16} />

  if (error) {
    return (
      <Callout intent="danger" compact>
        {error}
      </Callout>
    )
  }

  if (events.length === 0) {
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
