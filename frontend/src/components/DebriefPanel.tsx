import { useMemo, useRef, useState } from 'react'
import { Button, Callout, HTMLSelect, NonIdealState, Spinner, Tag } from '@blueprintjs/core'
import { useNavigate } from 'react-router-dom'
import { getAsset } from '../api/assets'
import { getApiErrorMessage } from '../api/client'
import { getTask } from '../api/tasks'
import type { AuditEvent } from '../api/types'
import { useReplay } from '../context/ReplayContext'
import { AppToaster } from '../lib/toaster'
import { humanize } from '../utils/humanize'
import DebriefEventDiff from './DebriefEventDiff'
import { diffSnapshots, isDiffEmpty } from '../utils/diffSnapshots'
import {
  DEBRIEF_RANGE_OPTIONS,
  useDebriefTimeline,
  type DebriefRange,
} from '../hooks/useDebriefTimeline'

const RECONSTRUCTABLE_ENTITY_TYPES = ['Incident', 'Site', 'Task', 'Asset'] as const
type ReconstructableEntityType = (typeof RECONSTRUCTABLE_ENTITY_TYPES)[number]
type ReconstructableEvent = AuditEvent & { entity_type: ReconstructableEntityType }

function isReconstructable(event: AuditEvent): event is ReconstructableEvent {
  return (RECONSTRUCTABLE_ENTITY_TYPES as readonly string[]).includes(event.entity_type)
}

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

async function resolveReconstructionTarget(event: ReconstructableEvent): Promise<string | null> {
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
  }
}

interface DebriefPanelProps {
  /**
   * When true, clicking a reconstructable event still calls setAsOf (so
   * shared replay state advances) but skips the navigate-to-entity-page
   * side effect. Used by the inline-on-map surface where the operator
   * should stay on /map with the map entering replay, not be yanked to
   * /sites/:id. Defaults to false — the standalone /debrief page keeps
   * its navigate-away behavior unchanged.
   */
  noNavigate?: boolean
}

export default function DebriefPanel({ noNavigate = false }: DebriefPanelProps = {}) {
  const [range, setRange] = useState<DebriefRange>('24h')
  const [pendingEventId, setPendingEventId] = useState<string | null>(null)
  const [diffEvent, setDiffEvent] = useState<AuditEvent | null>(null)
  const navigate = useNavigate()
  const { setAsOf } = useReplay()
  const { events, error, isPending, hasMore, loadMore, isLoadingMore } = useDebriefTimeline({ range })

  // Monotonic token so a newer click supersedes any in-flight lookup.
  const latestClickToken = useRef(0)

  // Events that actually mutate stored fields deserve a "Show changes" affordance.
  // Pure creation/read events with no before and an empty after are suppressed so the
  // action is only offered when the diff drawer will have something useful to say.
  const eventsWithDiff = useMemo(() => {
    const set = new Set<string>()
    for (const event of events ?? []) {
      if (!isDiffEmpty(diffSnapshots(event.before_snapshot, event.after_snapshot))) {
        set.add(event.id)
      }
    }
    return set
  }, [events])

  async function handleReconstruct(event: AuditEvent) {
    if (!isReconstructable(event)) return

    const token = ++latestClickToken.current
    const requiresLookup = event.entity_type === 'Task' || event.entity_type === 'Asset'
    if (requiresLookup) setPendingEventId(event.id)

    try {
      // Only resolve the target if we'll actually navigate. Skipping the
      // lookup in noNavigate mode also avoids an unnecessary API call for
      // Task/Asset reconstructions, which is the whole point of inline
      // mode — replay-in-place, no cross-page redirect.
      const target = noNavigate ? null : await resolveReconstructionTarget(event)
      if (token !== latestClickToken.current) return
      if (requiresLookup) setPendingEventId(null)
      setAsOf(event.occurred_at)
      if (!noNavigate && target) navigate(target)
    } catch (err) {
      if (token !== latestClickToken.current) return
      if (requiresLookup) setPendingEventId(null)
      void AppToaster.then((t) =>
        t.show({
          message: getApiErrorMessage(err, 'Could not open reconstruction target'),
          intent: 'danger',
          icon: 'error',
          timeout: 4000,
        }),
      ).catch(() => {})
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
              const reconstructable = isReconstructable(event)
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

              const hasDiff = eventsWithDiff.has(event.id)

              return (
                <li key={event.id} className="timeline-item">
                  <div className="debrief-timeline-row">
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
                    {hasDiff && (
                      <button
                        type="button"
                        className="debrief-diff-action"
                        onClick={() => setDiffEvent(event)}
                        aria-label={`Show changes for ${event.entity_type} event`}
                        title="Show field-level changes for this event"
                      >
                        Show changes
                      </button>
                    )}
                  </div>
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

      <DebriefEventDiff event={diffEvent} onClose={() => setDiffEvent(null)} />
    </div>
  )
}
