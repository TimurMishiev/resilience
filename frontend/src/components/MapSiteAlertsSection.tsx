import { Button, Icon, Spinner, Tag, Tooltip } from '@blueprintjs/core'
import { Link } from 'react-router-dom'
import { useSignalRuleMatches, useTransitionAlert } from '../hooks/useSignalRuleMatches'
import { SIGNAL_ICON_NAME } from '../lib/signalIcons'
import { timeAgo } from '../lib/formatters'
import type { SignalRuleMatch } from '../api/types'

const TRIAGE_LIMIT = 5

interface MapSiteAlertsSectionProps {
  siteId: string
  referenceTimeMs: number
  isReplaying: boolean
  canTriage: boolean
}

export function MapSiteAlertsSection({
  siteId,
  referenceTimeMs,
  isReplaying,
  canTriage,
}: MapSiteAlertsSectionProps) {
  const { data, isLoading, error } = useSignalRuleMatches(
    { site_id: siteId, workflow_status: 'unacknowledged', per_page: TRIAGE_LIMIT },
    { enabled: !isReplaying, refetchInterval: isReplaying ? false : 10_000 },
  )

  if (isReplaying) return null

  const matches = data?.data ?? []
  const total = data?.meta?.total ?? matches.length
  const overflow = total > matches.length

  return (
    <section
      className="map-site-alerts"
      aria-label="Recent unacknowledged alerts"
      data-testid="map-site-alerts"
    >
      <header className="map-site-alerts-header">
        <span className="map-site-alerts-title">Unacknowledged alerts</span>
        {matches.length > 0 && (
          <Tag minimal intent="danger" data-testid="map-site-alerts-count">
            {total}
          </Tag>
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
            />
          ))}
        </ul>
      )}

      {overflow && (
        <Link
          to={`/alerts?site_id=${siteId}&workflow_status=unacknowledged`}
          className="map-site-alerts-more"
        >
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
}

function MapSiteAlertRow({ match, referenceTimeMs, canTriage }: MapSiteAlertRowProps) {
  const transition = useTransitionAlert()
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
          </span>
        </div>
      </div>
      {canTriage && (
        <Button
          small
          minimal
          intent="primary"
          disabled={transition.isPending}
          onClick={() =>
            transition.mutate({ id: match.id, body: { to_status: 'acknowledged' } })
          }
          data-testid="map-site-alert-ack"
        >
          Ack
        </Button>
      )}
    </li>
  )
}
