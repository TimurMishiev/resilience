import { useState } from 'react'
import { Button, Callout, HTMLSelect, NonIdealState, Spinner, Tag } from '@blueprintjs/core'
import type { AuditEvent } from '../api/types'
import { humanize } from '../utils/humanize'
import {
  DEBRIEF_RANGE_OPTIONS,
  useDebriefTimeline,
  type DebriefRange,
} from '../hooks/useDebriefTimeline'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function eventLabel(event: AuditEvent): string {
  if (event.action) return humanize(event.action)
  return humanize(event.event_type)
}

export default function DebriefPanel() {
  const [range, setRange] = useState<DebriefRange>('24h')
  const { events, error, isPending, hasMore, loadMore, isLoadingMore } = useDebriefTimeline({ range })

  return (
    <div className="debrief-panel">
      <div className="debrief-controls">
        <label className="bp6-text-muted debrief-range-label" htmlFor="debrief-range">
          Time range
        </label>
        <HTMLSelect
          id="debrief-range"
          value={range}
          onChange={(e) => setRange(e.currentTarget.value as DebriefRange)}
          options={DEBRIEF_RANGE_OPTIONS}
        />
      </div>

      {isPending && <Spinner size={20} />}

      {error && (
        <Callout intent="danger" className="debrief-error">
          {error.message}
        </Callout>
      )}

      {!isPending && !error && (!events || events.length === 0) && (
        <NonIdealState
          icon="timeline-events"
          title="No meaningful activity"
          description="No operationally significant events occurred in this range."
        />
      )}

      {!isPending && !error && events && events.length > 0 && (
        <>
          <ol className="timeline debrief-timeline">
            {events.map((event) => (
              <li key={event.id} className="timeline-item">
                <div className="timeline-meta">
                  <span className="timeline-time bp6-text-muted">{formatTime(event.occurred_at)}</span>
                  <span className="timeline-actor bp6-text-muted">{event.actor}</span>
                </div>
                <div className="timeline-body">
                  <Tag minimal intent="primary" className="debrief-entity-tag">
                    {event.entity_type}
                  </Tag>
                  <Tag minimal className="timeline-label">{eventLabel(event)}</Tag>
                </div>
              </li>
            ))}
          </ol>

          {hasMore && (
            <div className="debrief-load-more">
              <Button
                text="Load older events"
                onClick={() => void loadMore()}
                loading={isLoadingMore}
                outlined
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
