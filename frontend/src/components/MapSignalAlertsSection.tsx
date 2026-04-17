import { useCallback, useState } from 'react'
import { Button, Icon, Spinner, Tag, Tooltip } from '@blueprintjs/core'
import { useSignalRuleMatches, useTransitionAlert } from '../hooks/useSignalRuleMatches'
import { useReplayParams } from '../hooks/useReplayParams'
import { timeAgo } from '../lib/formatters'
import type { SignalRuleMatch } from '../api/types'

const TRIAGE_LIMIT = 5

interface MapSignalAlertsSectionProps {
  signalId: string
  referenceTimeMs: number
  canTriage: boolean
}

export function MapSignalAlertsSection({
  signalId,
  referenceTimeMs,
  canTriage,
}: MapSignalAlertsSectionProps) {
  const { isReplaying } = useReplayParams()

  const { data, isLoading, error } = useSignalRuleMatches(
    { signal_id: signalId, workflow_status: 'unacknowledged', per_page: TRIAGE_LIMIT },
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

  const matches = data?.data ?? []
  const total   = data?.meta?.total ?? matches.length

  return (
    <section
      className="map-site-alerts"
      aria-label="Recent unacknowledged alerts triggered by this signal"
      data-testid="map-signal-alerts"
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
          No unacknowledged alerts triggered by this signal.
        </div>
      )}

      {matches.length > 0 && (
        <ul className="map-site-alert-list">
          {matches.map(match => (
            <SignalAlertRow
              key={match.id}
              match={match}
              referenceTimeMs={referenceTimeMs}
              canTriage={canTriage}
              isPending={pendingAckId === match.id}
              hasFailed={failedAckId === match.id}
              onAck={handleAck}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function SignalAlertRow({
  match,
  referenceTimeMs,
  canTriage,
  isPending,
  hasFailed,
  onAck,
}: {
  match: SignalRuleMatch
  referenceTimeMs: number
  canTriage: boolean
  isPending: boolean
  hasFailed: boolean
  onAck: (id: string) => void
}) {
  const conf = typeof match.confidence === 'number' ? match.confidence : null
  const ruleName =
    match.correlation_rule?.name ??
    (match.metadata?.geofence_breach ? 'Geofence breach' : 'Unknown rule')

  return (
    <li className="map-site-alert-row" data-testid="map-signal-alert-row">
      <div className="map-site-alert-row-main">
        <span className="map-site-alert-icon">
          <Icon icon="notifications" size={12} />
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
            {match.workflow_status !== 'unacknowledged' && (
              <>
                {' · '}
                <Tag minimal small>{match.workflow_status}</Tag>
              </>
            )}
            {hasFailed && (
              <>
                {' · '}
                <span className="map-site-alert-failed" data-testid="map-signal-alert-failed">
                  Ack failed — retry
                </span>
              </>
            )}
          </span>
        </div>
      </div>
      {canTriage && match.workflow_status === 'unacknowledged' && (
        <Button
          small
          minimal
          intent="primary"
          loading={isPending}
          onClick={() => onAck(match.id)}
          data-testid="map-signal-alert-ack"
        >
          Ack
        </Button>
      )}
    </li>
  )
}
