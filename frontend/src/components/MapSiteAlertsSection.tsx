import { useCallback, useState } from 'react'
import { Button, Icon, Spinner, Tag, Tooltip } from '@blueprintjs/core'
import { Link } from 'react-router-dom'
import { useSignalRuleMatches, useTransitionAlert } from '../hooks/useSignalRuleMatches'
import { useReplayParams } from '../hooks/useReplayParams'
import { SIGNAL_ICON_NAME } from '../lib/signalIcons'
import { timeAgo } from '../lib/formatters'
import { priorityIntent, workflowIntent } from '../lib/taskIntents'
import type { SignalRuleMatch } from '../api/types'
import { humanize } from '../utils/humanize'

const TRIAGE_LIMIT = 5

interface MapSiteAlertsSectionProps {
  siteId: string
  referenceTimeMs: number
  canTriage: boolean
  onSelectSignal: (signalId: string) => void
}

export function MapSiteAlertsSection({
  siteId,
  referenceTimeMs,
  canTriage,
  onSelectSignal,
}: MapSiteAlertsSectionProps) {
  const { isReplaying, asOf } = useReplayParams()

  const { data, isLoading, error } = useSignalRuleMatches(
    { site_id: siteId, workflow_status: 'unacknowledged', per_page: TRIAGE_LIMIT },
    { enabled: !isReplaying },
  )

  const transition = useTransitionAlert()
  const [pendingAckId, setPendingAckId] = useState<string | null>(null)
  const [failedAckId, setFailedAckId]   = useState<string | null>(null)

  const handleAck = useCallback(
    (id: string) => {
      setFailedAckId(null)
      setPendingAckId(id)
      transition.mutate(
        { id, body: { to_status: 'acknowledged' } },
        {
          onSettled: () => setPendingAckId(null),
          onError:   () => setFailedAckId(id),
        },
      )
    },
    [transition],
  )

  if (isReplaying) return null

  const matches  = data?.data ?? []
  const total    = data?.meta?.total ?? matches.length
  const overflow = total > matches.length

  // Preserve as_of so a future replay-aware surface doesn't jump the operator
  // out of the replay frame. Currently unreachable (section null-renders in
  // replay) but cheap defensive wiring.
  const overflowHref =
    `/alerts?site_id=${siteId}&workflow_status=unacknowledged` +
    (asOf ? `&as_of=${encodeURIComponent(asOf)}` : '')

  return (
    <section
      className="map-site-alerts"
      aria-label="Recent unacknowledged alerts"
      data-testid="map-site-alerts"
    >
      <header className="map-site-alerts-header">
        <span className="map-site-alerts-title">Unacknowledged alerts</span>
        {matches.length > 0 && (
          <Tag minimal intent="danger">{total}</Tag>
        )}
      </header>

      {isLoading && (
        <div className="map-site-alerts-empty">
          <Spinner size={14} /> <span className="bp6-text-muted">Loading…</span>
        </div>
      )}

      {!isLoading && error && (
        <div className="map-site-alerts-empty bp6-text-muted">
          Failed to load alerts.
        </div>
      )}

      {!isLoading && !error && matches.length === 0 && (
        <div className="map-site-alerts-empty bp6-text-muted">
          No unacknowledged alerts.
        </div>
      )}

      {matches.length > 0 && (
        <ul className="map-site-alert-list">
          {matches.map(match => (
            <MapSiteAlertRow
              key={match.id}
              match={match}
              referenceTimeMs={referenceTimeMs}
              canTriage={canTriage}
              isPending={pendingAckId === match.id}
              hasFailed={failedAckId === match.id}
              onSelectSignal={onSelectSignal}
              onAck={handleAck}
            />
          ))}
        </ul>
      )}

      {overflow && (
        <Link to={overflowHref} className="map-site-alerts-more">
          View all {total} →
        </Link>
      )}
    </section>
  )
}

interface MapSiteAlertRowProps {
  match: SignalRuleMatch
  referenceTimeMs: number
  canTriage: boolean
  isPending: boolean
  hasFailed: boolean
  onSelectSignal: (signalId: string) => void
  onAck: (id: string) => void
}

function MapSiteAlertRow({
  match,
  referenceTimeMs,
  canTriage,
  isPending,
  hasFailed,
  onSelectSignal,
  onAck,
}: MapSiteAlertRowProps) {
  const conf = typeof match.confidence === 'number' ? match.confidence : null
  const ruleName =
    match.correlation_rule?.name ??
    (match.metadata?.geofence_breach ? 'Geofence breach' : 'Unknown rule')
  const iconName = match.signal ? SIGNAL_ICON_NAME[match.signal.signal_type] ?? 'dot' : 'dot'

  return (
    <li className="map-site-alert-row" data-testid="map-site-alert-row">
      <div className="map-site-alert-row-main">
        <span className="map-site-alert-icon">
          <Icon icon={iconName} size={12} />
        </span>
        <div className="map-site-alert-body">
          <span className="map-site-alert-rule">{ruleName}</span>
          <span className="map-site-alert-meta bp6-text-muted">
            {timeAgo(match.fired_at, referenceTimeMs)}
            {conf != null && (
              <>
                {' · '}
                <Tooltip content={`Match confidence: ${Math.round(conf * 100)}%`} placement="top">
                  <span style={{ cursor: 'default' }}>{Math.round(conf * 100)}%</span>
                </Tooltip>
              </>
            )}
            {hasFailed && (
              <>
                {' · '}
                <span
                  className="map-site-alert-failed"
                  data-testid="map-site-alert-failed"
                >
                  Ack failed — retry
                </span>
              </>
            )}
          </span>
          {match.task && (
            <div className="map-site-alert-task" data-testid="map-site-alert-task">
              <span className="map-site-alert-task-title">{match.task.title}</span>
              <div className="map-site-alert-task-tags">
                <Tag minimal intent={workflowIntent(match.task.workflow_status)}>
                  {humanize(match.task.workflow_status)}
                </Tag>
                <Tag minimal intent={priorityIntent(match.task.priority)}>
                  {match.task.priority}
                </Tag>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="map-panel-actions">
        {match.signal && (
          <Button
            small
            minimal
            icon="notifications"
            onClick={() => onSelectSignal(match.signal!.id)}
            data-testid="map-site-alert-open-signal"
          >
            Inspect signal
          </Button>
        )}
        {canTriage && (
          <Button
            small
            minimal
            intent="primary"
            loading={isPending}
            onClick={() => onAck(match.id)}
            data-testid="map-site-alert-ack"
          >
            Ack
          </Button>
        )}
      </div>
    </li>
  )
}
