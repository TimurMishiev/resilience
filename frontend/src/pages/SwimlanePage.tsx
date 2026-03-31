import { useMemo, useState } from 'react'
import { Button, ButtonGroup, Callout, NonIdealState, Spinner, Tag, Tooltip } from '@blueprintjs/core'
import { Link } from 'react-router-dom'
import { useSwimlane } from '../hooks/useReadiness'
import { useReplay } from '../context/ReplayContext'
import { useReferenceTimeMs } from '../hooks/useReferenceTimeMs'
import type { SwimlaneLane, TimelineEvent, TimelineEventKind } from '../api/types'

const LOOKBACK_OPTIONS = [1, 3, 7, 14] as const
const ALL_KINDS: TimelineEventKind[] = [
  'signal_detected',
  'rule_fired',
  'task_created',
  'task_transitioned',
  'site_event',
]

const KIND_CONFIG: Record<TimelineEventKind, {
  color: string
  label: string
  icon: string
  intent: 'none' | 'primary' | 'warning' | 'danger' | 'success'
}> = {
  signal_detected: { color: '#4fc3f7', label: 'Signal', icon: 'satellite', intent: 'primary' },
  rule_fired: { color: '#ffb74d', label: 'Alert', icon: 'warning-sign', intent: 'warning' },
  task_created: { color: '#81c784', label: 'Task', icon: 'add-to-artifact', intent: 'success' },
  task_transitioned: { color: '#ce93d8', label: 'Task Update', icon: 'exchange', intent: 'none' },
  site_event: { color: '#90a4ae', label: 'Site', icon: 'map-marker', intent: 'none' },
}

const AXIS_MARKERS = [0, 0.25, 0.5, 0.75, 1]
const LANE_LIMIT = 8

function fmtAxisLabel(timestampMs: number) {
  return new Date(timestampMs).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtTimestamp(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function EventDot({
  event,
  leftPct,
  stackRow,
}: {
  event: TimelineEvent
  leftPct: number
  stackRow: number
}) {
  const cfg = KIND_CONFIG[event.event_kind]

  return (
    <Tooltip
      placement="top"
      content={
        <div className="swimlane-tooltip">
          <div className="swimlane-tooltip-header">
            <Tag minimal intent={cfg.intent}>{cfg.label}</Tag>
            <span className="bp6-text-muted">{fmtTimestamp(event.occurred_at)}</span>
          </div>
          <div className="swimlane-tooltip-title">{event.title}</div>
          {event.subtitle && <div className="swimlane-tooltip-subtitle">{event.subtitle}</div>}
          {event.actor && event.actor !== 'system' && (
            <div className="bp6-text-muted" style={{ marginTop: 4, fontSize: 11 }}>
              {event.actor}
            </div>
          )}
        </div>
      }
    >
      <button
        type="button"
        className="swimlane-event-dot"
        style={{
          left: `${leftPct}%`,
          top: `${12 + stackRow * 18}px`,
          borderColor: cfg.color,
          background: `${cfg.color}22`,
          color: cfg.color,
        }}
        aria-label={`${cfg.label}: ${event.title}`}
      />
    </Tooltip>
  )
}

function SwimlaneLaneRow({
  lane,
  windowStartMs,
  windowEndMs,
}: {
  lane: SwimlaneLane
  windowStartMs: number
  windowEndMs: number
}) {
  const eventsAscending = [...lane.events].sort(
    (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at),
  )
  const windowDuration = Math.max(1, windowEndMs - windowStartMs)

  return (
    <section className="swimlane-lane" aria-label={`Swimlane for ${lane.site_name}`}>
      <div className="swimlane-lane-header">
        <div>
          <Link className="swimlane-lane-link" to={`/sites/${lane.site_id}`}>
            {lane.site_name}
          </Link>
          <div className="swimlane-lane-subtitle bp6-text-muted">
            {lane.area_of_operation_name ?? 'No AO assigned'}
          </div>
        </div>
        <div className="swimlane-lane-tags">
          <Tag minimal>{lane.event_count} events</Tag>
          {lane.visible_event_count < lane.event_count && (
            <Tag minimal intent="warning">showing {lane.visible_event_count}</Tag>
          )}
          <Tag minimal intent="primary">Last {fmtTimestamp(lane.last_event_at)}</Tag>
        </div>
      </div>

      <div className="swimlane-track">
        {AXIS_MARKERS.map((marker) => (
          <div
            key={marker}
            className="swimlane-gridline"
            style={{ left: `${marker * 100}%` }}
            aria-hidden="true"
          />
        ))}
        {(() => {
          // Greedy time-aware row assignment: assign each event (oldest→newest)
          // to the row whose last-placed event is earliest, minimising overlap.
          const rowLastAtMs = [0, 0, 0]
          return eventsAscending.map((event) => {
            const occurredAtMs = Date.parse(event.occurred_at)
            const leftPct = Math.max(
              0,
              Math.min(100, ((occurredAtMs - windowStartMs) / windowDuration) * 100),
            )
            const row = rowLastAtMs.indexOf(Math.min(...rowLastAtMs))
            rowLastAtMs[row] = occurredAtMs

            return (
              <EventDot
                key={event.id}
                event={event}
                leftPct={leftPct}
                stackRow={row}
              />
            )
          })
        })()}
      </div>
    </section>
  )
}

export default function SwimlanePage() {
  const { asOf, isReplaying } = useReplay()
  const [days, setDays] = useState<number>(3)
  const [activeKinds, setActiveKinds] = useState<TimelineEventKind[]>(ALL_KINDS)

  const kinds = activeKinds.length === ALL_KINDS.length ? undefined : activeKinds
  const { data, isPending, error, dataUpdatedAt } = useSwimlane(
    { days, kinds, lane_limit: LANE_LIMIT },
    { enabled: !isReplaying },
  )

  const nowMs = useReferenceTimeMs(asOf)
  const windowStartMs = nowMs - days * 24 * 60 * 60 * 1000
  const lanes = data?.data ?? []
  const meta = data?.meta
  const summary = !isPending && !error
    ? `Showing ${meta?.lane_count ?? 0} sites / ${meta?.total_events ?? 0} events over ${days} day${days === 1 ? '' : 's'}${dataUpdatedAt ? ` · updated ${fmtTimestamp(new Date(dataUpdatedAt).toISOString())}` : ''}`
    : 'Loading live swimlane…'

  const axisLabels = useMemo(
    () => AXIS_MARKERS.map((marker) => ({
      marker,
      label: fmtAxisLabel(windowStartMs + marker * (nowMs - windowStartMs)),
    })),
    [nowMs, windowStartMs],
  )

  function toggleKind(kind: TimelineEventKind) {
    setActiveKinds((current) => (
      current.includes(kind)
        ? current.length === 1
          ? current
          : current.filter((value) => value !== kind)
        : [...current, kind]
    ))
  }

  return (
    <div className="swimlane-page">
      <div className="page-header">
        <div>
          <h2>Swimlane</h2>
          <p className="bp6-text-muted" style={{ margin: '4px 0 0', maxWidth: 760 }}>
            Cross-site temporal view of signals, alerts, tasks, and site actions. This surface is
            live-only and ranks the busiest active sites in the current lookback window.
          </p>
        </div>
      </div>

      {isReplaying && (
        <Callout intent="warning" icon="history" style={{ marginBottom: 16 }}>
          Swimlane is unavailable during replay because it aggregates live site timelines and alert
          state. Return to live mode to inspect current operational tempo.
        </Callout>
      )}

      <div className="swimlane-controls">
        <ButtonGroup minimal style={{ gap: 2, flexWrap: 'wrap' }}>
          {LOOKBACK_OPTIONS.map((option) => (
            <Button
              key={option}
              small
              active={days === option}
              intent={days === option ? 'primary' : 'none'}
              onClick={() => setDays(option)}
            >
              {option}d
            </Button>
          ))}
        </ButtonGroup>

        <ButtonGroup minimal style={{ gap: 2, flexWrap: 'wrap' }}>
          {ALL_KINDS.map((kind) => {
            const cfg = KIND_CONFIG[kind]
            const active = activeKinds.includes(kind)
            return (
              <Button
                key={kind}
                small
                active={active}
                intent={active ? cfg.intent : 'none'}
                style={{
                  borderBottom: active ? `2px solid ${cfg.color}` : '2px solid transparent',
                  fontSize: 11,
                }}
                onClick={() => toggleKind(kind)}
              >
                {cfg.label}
              </Button>
            )
          })}
          <Button small minimal style={{ fontSize: 11 }} onClick={() => setActiveKinds(ALL_KINDS)}>
            All
          </Button>
        </ButtonGroup>
      </div>

      {!isReplaying && <div className="swimlane-summary bp6-text-muted">{summary}</div>}

      {!isReplaying && (
        <div className="swimlane-axis" aria-hidden="true">
          {axisLabels.map((entry) => (
            <span
              key={entry.marker}
              className="swimlane-axis-label"
              style={{ left: `${entry.marker * 100}%` }}
            >
              {entry.label}
            </span>
          ))}
        </div>
      )}

      {!isReplaying && isPending && (
        <div className="swimlane-loading">
          <Spinner size={28} />
        </div>
      )}

      {!isReplaying && error && (
        <Callout intent="danger" icon="error" style={{ marginTop: 12 }}>
          {(error as Error).message || 'Failed to load swimlane analytics.'}
        </Callout>
      )}

      {!isReplaying && !isPending && !error && lanes.length === 0 && (
        <NonIdealState
          icon="timeline-events"
          title="No recent cross-site activity"
          description="No active sites produced swimlane events in the selected lookback window."
        />
      )}

      {!isReplaying && !isPending && !error && lanes.length > 0 && (
        <div className="swimlane-list">
          {lanes.map((lane) => (
            <SwimlaneLaneRow
              key={lane.site_id}
              lane={lane}
              windowStartMs={windowStartMs}
              windowEndMs={nowMs}
            />
          ))}
        </div>
      )}
    </div>
  )
}
