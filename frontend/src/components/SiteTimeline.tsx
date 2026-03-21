import { useState } from 'react'
import {
  Button,
  ButtonGroup,
  Callout,
  Icon,
  NonIdealState,
  Spinner,
  Tag,
  Tooltip,
} from '@blueprintjs/core'
import { useSiteTimeline } from '../hooks/useSite'
import { SIGNAL_ICON_NAME } from '../lib/signalIcons'
import type { TimelineEvent, TimelineEventKind, SignalType } from '../api/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m    = Math.floor(diff / 60_000)
  if (m < 1)   return 'just now'
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function fmtFull(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── per-kind config ───────────────────────────────────────────────────────────

type KindConfig = {
  icon:   string
  color:  string
  label:  string
  intent: 'none' | 'primary' | 'warning' | 'danger' | 'success'
}

const KIND_CONFIG: Record<TimelineEventKind, KindConfig> = {
  signal_detected:   { icon: 'satellite',    color: '#4fc3f7', label: 'Signal',      intent: 'primary'  },
  rule_fired:        { icon: 'warning-sign', color: '#ffb74d', label: 'Alert',       intent: 'warning'  },
  task_created:      { icon: 'add-to-artifact', color: '#81c784', label: 'Task',     intent: 'success'  },
  task_transitioned: { icon: 'exchange',     color: '#ce93d8', label: 'Task Update', intent: 'none'     },
  site_event:        { icon: 'map-marker',   color: '#90a4ae', label: 'Site',        intent: 'none'     },
}

const ALERT_STATUS_INTENT: Record<string, 'danger' | 'warning' | 'primary' | 'success'> = {
  unacknowledged: 'danger',
  acknowledged:   'warning',
  investigating:  'primary',
  closed:         'success',
}

const CONFIDENCE_INTENT = (c: number): 'success' | 'primary' | 'warning' | 'danger' =>
  c >= 0.8 ? 'success' : c >= 0.6 ? 'primary' : c >= 0.4 ? 'warning' : 'danger'

const ALL_KINDS: TimelineEventKind[] = [
  'signal_detected',
  'rule_fired',
  'task_created',
  'task_transitioned',
  'site_event',
]

// ── single event row ──────────────────────────────────────────────────────────

function EventRow({ event }: { event: TimelineEvent }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = KIND_CONFIG[event.event_kind]

  const signalIcon =
    event.event_kind === 'signal_detected' && event.meta.signal_type
      ? SIGNAL_ICON_NAME[event.meta.signal_type as SignalType]
      : null

  return (
    <li className="threat-timeline-item">
      {/* ── dot + line ── */}
      <div className="tt-spine">
        <div className="tt-dot" style={{ background: cfg.color }} />
      </div>

      {/* ── content ── */}
      <div className="tt-content">
        <div className="tt-header">
          {/* kind badge */}
          <Icon
            icon={signalIcon ?? cfg.icon as never}
            size={12}
            color={cfg.color}
            style={{ flexShrink: 0 }}
          />
          <Tag
            minimal
            intent={cfg.intent}
            style={{ fontSize: 10, lineHeight: '14px' }}
          >
            {cfg.label}
          </Tag>

          {/* confidence pill for rule fires */}
          {event.event_kind === 'rule_fired' && event.confidence != null && (
            <Tag
              minimal
              intent={CONFIDENCE_INTENT(event.confidence)}
              style={{ fontSize: 10, lineHeight: '14px' }}
            >
              {Math.round(event.confidence * 100)}%
            </Tag>
          )}

          {/* workflow status for rule fires */}
          {event.event_kind === 'rule_fired' && event.workflow_status && (
            <Tag
              minimal
              intent={ALERT_STATUS_INTENT[event.workflow_status] ?? 'none'}
              style={{ fontSize: 10, lineHeight: '14px' }}
            >
              {event.workflow_status}
            </Tag>
          )}

          {/* timestamp */}
          <Tooltip content={fmtFull(event.occurred_at)} placement="top">
            <span className="tt-time bp6-text-muted">
              {timeAgo(event.occurred_at)}
            </span>
          </Tooltip>

          {/* actor */}
          {event.actor && event.actor !== 'system' && (
            <span className="tt-actor bp6-text-muted">
              {event.actor}
            </span>
          )}

          {/* expand toggle */}
          <Button
            minimal small
            icon={expanded ? 'chevron-up' : 'chevron-down'}
            style={{ marginLeft: 'auto', padding: 2, minWidth: 0 }}
            onClick={() => setExpanded(v => !v)}
          />
        </div>

        {/* title + subtitle */}
        <div className="tt-title">{event.title}</div>
        {event.subtitle && (
          <div className="tt-subtitle bp6-text-muted">{event.subtitle}</div>
        )}

        {/* expanded meta panel */}
        {expanded && (
          <div className="tt-meta">
            {Object.entries(event.meta).map(([k, v]) => {
              if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return null
              const displayVal = Array.isArray(v) ? v.join(', ') : String(v)
              return (
                <div key={k} className="tt-meta-row">
                  <span className="tt-meta-key">{k.replace(/_/g, ' ')}</span>
                  <span className="tt-meta-val mono">{displayVal}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </li>
  )
}

// ── kind filter bar ───────────────────────────────────────────────────────────

function KindFilter({
  active,
  onChange,
}: {
  active: TimelineEventKind[]
  onChange: (kinds: TimelineEventKind[]) => void
}) {
  function toggle(kind: TimelineEventKind) {
    onChange(
      active.includes(kind)
        ? active.filter(k => k !== kind)
        : [...active, kind]
    )
  }

  return (
    <ButtonGroup minimal style={{ gap: 2, flexWrap: 'wrap', marginBottom: 12 }}>
      {ALL_KINDS.map(kind => {
        const cfg = KIND_CONFIG[kind]
        const on  = active.includes(kind)
        return (
          <Button
            key={kind}
            small
            active={on}
            intent={on ? cfg.intent : 'none'}
            style={{
              fontSize: 11,
              borderBottom: on ? `2px solid ${cfg.color}` : '2px solid transparent',
            }}
            onClick={() => toggle(kind)}
          >
            {cfg.label}
          </Button>
        )
      })}
      <Button
        small minimal
        style={{ fontSize: 11, marginLeft: 8 }}
        onClick={() => onChange(ALL_KINDS)}
      >
        All
      </Button>
    </ButtonGroup>
  )
}

// ── main component ────────────────────────────────────────────────────────────

interface Props {
  siteId: string
}

export default function SiteTimeline({ siteId }: Props) {
  const [activeKinds, setActiveKinds] = useState<TimelineEventKind[]>(ALL_KINDS)
  const [days, setDays]               = useState(7)

  const kinds = activeKinds.length === ALL_KINDS.length ? undefined : activeKinds

  const { data, isPending, error, dataUpdatedAt } = useSiteTimeline(siteId, {
    days,
    kinds,
  })

  const events = data?.data ?? []
  const total  = data?.meta.total ?? 0

  return (
    <div className="threat-timeline">
      {/* ── controls ── */}
      <div className="tt-controls">
        <KindFilter active={activeKinds} onChange={setActiveKinds} />

        <div className="tt-lookback">
          <span className="bp6-text-muted" style={{ fontSize: 11, marginRight: 6 }}>
            Lookback:
          </span>
          {[3, 7, 14, 30].map(d => (
            <Button
              key={d}
              small minimal
              active={days === d}
              style={{ fontSize: 11 }}
              onClick={() => setDays(d)}
            >
              {d}d
            </Button>
          ))}
        </div>
      </div>

      {/* ── header row ── */}
      <div className="tt-summary bp6-text-muted">
        {isPending
          ? 'Loading…'
          : `${total} event${total !== 1 ? 's' : ''} · last ${days} days`}
        {dataUpdatedAt > 0 && (
          <span style={{ marginLeft: 8 }}>
            · updated {timeAgo(new Date(dataUpdatedAt).toISOString())}
          </span>
        )}
      </div>

      {/* ── states ── */}
      {isPending && <Spinner size={20} style={{ marginTop: 16 }} />}

      {error && (
        <Callout intent="danger" compact style={{ marginTop: 12 }}>
          {error.message}
        </Callout>
      )}

      {!isPending && !error && events.length === 0 && (
        <NonIdealState
          icon="history"
          title="No events"
          description={`No activity detected in the last ${days} days for the selected filters.`}
          className="tab-empty-state"
        />
      )}

      {/* ── list ── */}
      {events.length > 0 && (
        <ol className="threat-timeline-list">
          {events.map(event => (
            <EventRow key={event.id} event={event} />
          ))}
        </ol>
      )}
    </div>
  )
}
