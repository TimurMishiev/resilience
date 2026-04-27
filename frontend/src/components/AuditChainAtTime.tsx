import { Callout, Spinner, Tag } from '@blueprintjs/core'
import { useReplayParams } from '../hooks/useReplayParams'
import { useAuditEvents } from '../hooks/useAuditEvents'
import type { AuditEvent } from '../api/types'
import { humanize } from '../utils/humanize'

interface Props {
  entityType: string
  entityId: string
  isReplaying: boolean
}

interface BodyProps {
  entityType: string
  entityId: string
}

/**
 * Tranche 6-C — replay-only audit-chain section for inspector panels.
 *
 * Renders an inline audit-event list for the selected entity at the
 * current replay cursor, with **a visible citation ID per row** — the
 * load-bearing operator deliverable for 6-C ("see what was true and how
 * we know"). Each row shows time + actor + event tag + changed keys +
 * citation handle (first 8 chars of the event UUID, full UUID in the
 * `title` attribute for hover-disclosure and copy).
 *
 * Outer/inner split (Codex round-3 fix-forward):
 *
 *   - The outer component takes `isReplaying` as a prop and returns
 *     null in live mode BEFORE rendering anything OR calling any hooks
 *     beyond the early return. No live-mode side effects.
 *   - The inner `AuditChainAtTimeBody` component holds the
 *     `useReplayParams()` + `useAuditEvents()` calls. It only mounts
 *     when `isReplaying` is true, so the audit-events query never
 *     fires in live mode. Round-2 violated this contract by calling
 *     hooks above the early return; the split restores it.
 *
 * Why not delegate to `AuditTimeline`: AuditTimeline does not render
 * citation IDs, and modifying it would change three other surfaces
 * (EntityCard, SiteDetailPage, IncidentDetailPage) outside the locked
 * 6-C scope.
 *
 * The audit-events backend allowlist (audit_events_controller's
 * ENTITY_ACCESS_MODELS) covers Site/Asset/Incident/Task/etc. but does
 * NOT include `Signal`/`ExternalSignal`, so this component is only
 * inserted into Site and Asset panels in 6-C. Signal-panel audit
 * chains are deferred to a future slice.
 */
export default function AuditChainAtTime({ entityType, entityId, isReplaying }: Props) {
  // Live-mode no-op. Returns null BEFORE any hook calls so live-mode
  // selection issues no hidden audit-events fetch and pays zero cost.
  // The body's hooks only run when this component is actually mounted.
  if (!isReplaying) return null
  return <AuditChainAtTimeBody entityType={entityType} entityId={entityId} />
}

function AuditChainAtTimeBody({ entityType, entityId }: BodyProps) {
  const { asOf } = useReplayParams()
  const { data: events, error, isPending } = useAuditEvents({
    entity_type: entityType,
    entity_id: entityId,
    limit: 50,
    ...(asOf ? { as_of: asOf } : {}),
  })

  return (
    <div className="audit-chain-at-time" data-testid="audit-chain-at-time">
      <h6 className="audit-chain-at-time-title bp6-heading">Audit chain at this moment</h6>
      {renderBody(events, isPending, error)}
    </div>
  )
}

function renderBody(
  events: AuditEvent[] | undefined,
  isPending: boolean,
  error: unknown,
) {
  if (isPending) return <Spinner size={16} />
  if (error instanceof Error) {
    return <Callout intent="danger" compact>{error.message}</Callout>
  }
  if (!events || events.length === 0) {
    return (
      <p className="bp6-text-muted audit-chain-empty">
        No audit events recorded up to the replay timestamp.
      </p>
    )
  }

  return (
    <ol className="audit-chain-list">
      {events.map((event) => {
        const changed = changedKeys(event.before_snapshot, event.after_snapshot)
        const citation = event.id.slice(0, 8)
        return (
          <li key={event.id} className="audit-chain-item" data-testid="audit-chain-row">
            <div className="audit-chain-meta">
              <span className="audit-chain-time bp6-text-muted">{formatTime(event.occurred_at)}</span>
              <span className="audit-chain-actor bp6-text-muted">{event.actor}</span>
              <code
                className="audit-chain-citation"
                data-testid="audit-chain-citation"
                title={event.id}
              >
                {citation}
              </code>
            </div>
            <div className="audit-chain-body">
              <Tag minimal className="audit-chain-label">{eventLabel(event)}</Tag>
              {changed.length > 0 && (
                <span className="audit-chain-changed bp6-text-muted">{changed.join(', ')}</span>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
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
