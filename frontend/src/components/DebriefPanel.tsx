import { useState } from 'react'
import { Button, Callout, HTMLSelect, NonIdealState, Spinner, Tag } from '@blueprintjs/core'
import { useNavigate } from 'react-router-dom'
import { getAsset } from '../api/assets'
import { getTask } from '../api/tasks'
import type { AuditEvent } from '../api/types'
import { useReplay } from '../context/ReplayContext'
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

function canReconstruct(event: AuditEvent): boolean {
  return ['Incident', 'Site', 'Task', 'Asset'].includes(event.entity_type)
}

async function resolveReconstructionTarget(event: AuditEvent): Promise<string | null> {
  switch (event.entity_type) {
    case 'Incident':
      return `/incidents/${event.entity_id}`
    case 'Site':
      return `/sites/${event.entity_id}`
    case 'Task': {
      const task = await getTask(event.entity_id, { as_of: event.occurred_at })
      return `/sites/${task.site_id}?task=${encodeURIComponent(task.id)}`
    }
    case 'Asset': {
      const asset = await getAsset(event.entity_id, { as_of: event.occurred_at })
      if (!asset.home_site_id) return null
      return `/sites/${asset.home_site_id}?asset=${encodeURIComponent(asset.id)}`
    }
    default:
      return null
  }
}

export default function DebriefPanel() {
  const [range, setRange] = useState<DebriefRange>('24h')
  const [pendingEventId, setPendingEventId] = useState<string | null>(null)
  const navigate = useNavigate()
  const { setAsOf } = useReplay()
  const { events, error, isPending, hasMore, loadMore, isLoadingMore } = useDebriefTimeline({ range })

  async function handleReconstruct(event: AuditEvent) {
    if (!canReconstruct(event)) return

    const requiresLookup = event.entity_type === 'Task' || event.entity_type === 'Asset'
    if (requiresLookup) setPendingEventId(event.id)

    try {
      const target = await resolveReconstructionTarget(event)
      if (requiresLookup) setPendingEventId(null)
      setAsOf(event.occurred_at)
      if (target) navigate(target)
    } catch {
      if (requiresLookup) setPendingEventId(null)
      setAsOf(event.occurred_at)
    }
  }

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
            {events.map((event) => {
              const reconstructable = canReconstruct(event)
              const rowBody = (
                <>
                  <div className="timeline-meta">
                    <span className="timeline-time bp6-text-muted">{formatTime(event.occurred_at)}</span>
                    <span className="timeline-actor bp6-text-muted">{event.actor}</span>
                  </div>
                  <div className="timeline-body">
                    <Tag minimal intent="primary" className="debrief-entity-tag">
                      {event.entity_type}
                    </Tag>
                    <Tag minimal className="timeline-label">{eventLabel(event)}</Tag>
                    {reconstructable && (
                      <span className="debrief-reconstruct-hint bp6-text-muted">Enter replay</span>
                    )}
                  </div>
                </>
              )

              return (
                <li key={event.id} className="timeline-item">
                  {reconstructable ? (
                    <button
                      type="button"
                      className="debrief-timeline-button"
                      onClick={() => void handleReconstruct(event)}
                      disabled={pendingEventId === event.id}
                      aria-label={`Enter replay from ${event.entity_type} event`}
                      title="Enter replay from this event"
                    >
                      {rowBody}
                    </button>
                  ) : (
                    rowBody
                  )}
                </li>
              )
            })}
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
