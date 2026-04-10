import { Callout, Classes, Icon } from '@blueprintjs/core'
import { useFeedHealth, useOperationalHealth } from '../hooks/useOperationalHealth'
import { useReplay } from '../context/ReplayContext'
import { useRole } from '../hooks/useRole'
import {
  FeedHealthTable,
  RelayHealthTable,
  RequestLatencyTable,
  SseConnectionsCard,
  FeedLagTable,
  AiResponseTimesTable,
} from '../components/operationalHealth/OperationalHealthTables'
import type {
  EndpointLatency,
  SseConnectionPayload,
  FeedLagEntry,
  AiServiceTiming,
} from '../components/operationalHealth/OperationalHealthTables'

export default function OperationalHealthPage() {
  const role = useRole()
  const canViewOperationalHealth = role.canViewOperationalHealth ?? role.isCommander
  const { isReplaying } = useReplay()
  const { data: feedData, isPending: feedPending, error: feedError } = useFeedHealth()
  const { data: opsData, isPending: opsPending, error: opsError, dataUpdatedAt } = useOperationalHealth()

  if (!canViewOperationalHealth) {
    return (
      <div className="page-content">
        <Callout intent="warning" icon="lock" title="Commander access required">
          Operational health monitoring is restricted to commanders and administrators.
        </Callout>
      </div>
    )
  }

  const feeds = feedData?.data ?? []
  const opsEntries = opsData?.data ?? []

  const okFeeds = feeds.filter(f => f.status === 'ok').length
  const errorFeeds = feeds.filter(f => f.status === 'error' || f.status === 'disabled').length
  const relayEntries = opsEntries.filter(e => e.category === 'relay_health')

  // Use React Query's dataUpdatedAt as the reference timestamp for stale
  // detection — avoids calling Date.now() during render (react-hooks/purity).
  const now = dataUpdatedAt || 0

  const staleRelays = relayEntries.filter(e => {
    const expires = e.payload.heartbeat_expires_at as string | undefined
    return expires ? Date.parse(expires) < now : false
  }).length

  // ── Platform Metrics (from Metrics::Recorder snapshots) ────────────
  const metricsEntries = opsEntries.filter(e => e.category === 'metrics')
  const latencyEntry = metricsEntries.find(e => e.key === 'request_latency')
  const sseEntry = metricsEntries.find(e => e.key === 'sse_connections')
  const feedLagEntry = metricsEntries.find(e => e.key === 'feed_lag')
  const aiTimingEntry = metricsEntries.find(e => e.key === 'ai_response_times')

  const requestEndpoints = (latencyEntry?.payload?.endpoints ?? []) as unknown as EndpointLatency[]
  const ssePayload = sseEntry?.payload ? sseEntry.payload as unknown as SseConnectionPayload : null
  const feedLagFeeds = (feedLagEntry?.payload?.feeds ?? []) as unknown as FeedLagEntry[]
  const aiServices = (aiTimingEntry?.payload?.services ?? []) as unknown as AiServiceTiming[]

  return (
    <div className="page-content">
      <div className="page-header">
        <h2 className="bp6-heading">
          <Icon icon="pulse" size={20} style={{ marginRight: 8 }} />
          Operational Health
        </h2>
        <span className="bp6-text-muted" style={{ fontSize: 12 }}>
          Auto-refreshes every 30s
        </span>
      </div>

      {isReplaying && (
        <Callout intent="warning" icon="history" style={{ marginBottom: 16 }}>
          Replay mode — health metrics reflect current platform state, not the replay timestamp.
        </Callout>
      )}

      {/* KPI row */}
      <div className="dashboard-kpi-row" style={{ marginBottom: 20 }}>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi-label bp6-text-muted">Feeds OK</span>
          <span className="dashboard-kpi-value" style={{ color: okFeeds > 0 ? '#3dcc91' : '#a7b6c2' }}>
            {feedPending ? <span className={Classes.SKELETON} style={{ width: 32, display: 'inline-block' }}>&nbsp;</span> : okFeeds}
          </span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi-label bp6-text-muted">Feeds Degraded</span>
          <span className="dashboard-kpi-value" style={{ color: errorFeeds > 0 ? '#f55656' : '#3dcc91' }}>
            {feedPending ? <span className={Classes.SKELETON} style={{ width: 32, display: 'inline-block' }}>&nbsp;</span> : errorFeeds}
          </span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi-label bp6-text-muted">Relays Active</span>
          <span className="dashboard-kpi-value" style={{ color: relayEntries.length > 0 ? '#3dcc91' : '#a7b6c2' }}>
            {opsPending ? <span className={Classes.SKELETON} style={{ width: 32, display: 'inline-block' }}>&nbsp;</span> : relayEntries.length - staleRelays}
          </span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi-label bp6-text-muted">Relays Stale</span>
          <span className="dashboard-kpi-value" style={{ color: staleRelays > 0 ? '#f55656' : '#3dcc91' }}>
            {opsPending ? <span className={Classes.SKELETON} style={{ width: 32, display: 'inline-block' }}>&nbsp;</span> : staleRelays}
          </span>
        </div>
      </div>

      {/* Feed Health */}
      <div className="dashboard-card" style={{ marginBottom: 20 }}>
        <h4 className="dashboard-card-title bp6-heading">
          <Icon icon="feed" size={14} style={{ marginRight: 6 }} />
          Feed Ingestion Health
        </h4>
        {feedError && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{feedError.message}</Callout>}
        {feedPending ? (
          <div className={Classes.SKELETON} style={{ width: '100%', height: 200 }}>&nbsp;</div>
        ) : (
          <FeedHealthTable feeds={feeds} />
        )}
      </div>

      {/* Relay Health */}
      <div className="dashboard-card" style={{ marginBottom: 20 }}>
        <h4 className="dashboard-card-title bp6-heading">
          <Icon icon="data-connection" size={14} style={{ marginRight: 6 }} />
          Realtime Relay Health
        </h4>
        {opsError && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{opsError.message}</Callout>}
        {opsPending ? (
          <div className={Classes.SKELETON} style={{ width: '100%', height: 120 }}>&nbsp;</div>
        ) : (
          <RelayHealthTable entries={opsEntries} now={now} />
        )}
      </div>

      {/* Platform Metrics */}
      <div className="dashboard-card" style={{ marginBottom: 20 }}>
        <h4 className="dashboard-card-title bp6-heading">
          <Icon icon="timeline-bar-chart" size={14} style={{ marginRight: 6 }} />
          Request Latency
        </h4>
        {opsPending ? (
          <div className={Classes.SKELETON} style={{ width: '100%', height: 120 }}>&nbsp;</div>
        ) : (
          <RequestLatencyTable endpoints={requestEndpoints} />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <div className="dashboard-card">
          <h4 className="dashboard-card-title bp6-heading">
            <Icon icon="cell-tower" size={14} style={{ marginRight: 6 }} />
            SSE Connections
          </h4>
          {opsPending ? (
            <div className={Classes.SKELETON} style={{ width: '100%', height: 60 }}>&nbsp;</div>
          ) : (
            <SseConnectionsCard payload={ssePayload} />
          )}
        </div>

        <div className="dashboard-card">
          <h4 className="dashboard-card-title bp6-heading">
            <Icon icon="predictive-analysis" size={14} style={{ marginRight: 6 }} />
            AI Service Response Times
          </h4>
          {opsPending ? (
            <div className={Classes.SKELETON} style={{ width: '100%', height: 60 }}>&nbsp;</div>
          ) : (
            <AiResponseTimesTable services={aiServices} />
          )}
        </div>
      </div>

      <div className="dashboard-card" style={{ marginBottom: 20 }}>
        <h4 className="dashboard-card-title bp6-heading">
          <Icon icon="time" size={14} style={{ marginRight: 6 }} />
          Feed Ingestion Lag
        </h4>
        {opsPending ? (
          <div className={Classes.SKELETON} style={{ width: '100%', height: 120 }}>&nbsp;</div>
        ) : (
          <FeedLagTable feeds={feedLagFeeds} />
        )}
      </div>

      {/* Error messages callout — shown if any feed has errors */}
      {feeds.some(f => f.error_messages && f.error_messages.length > 0) && (
        <Callout intent="warning" title="Recent Feed Errors" icon="warning-sign" style={{ marginBottom: 20 }}>
          {feeds
            .filter(f => f.error_messages && f.error_messages.length > 0)
            .map(f => (
              <div key={f.feed} style={{ marginBottom: 6 }}>
                <strong>{f.feed}:</strong>{' '}
                <span className="bp6-text-muted">{f.error_messages!.join(' | ')}</span>
              </div>
            ))}
        </Callout>
      )}
    </div>
  )
}
