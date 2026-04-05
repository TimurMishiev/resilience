import { Callout, Classes, HTMLTable, Icon, Tag, ProgressBar } from '@blueprintjs/core'
import { useFeedHealth, useOperationalHealth } from '../hooks/useOperationalHealth'
import type { FeedHealthEntry, OperationalStatusEntry } from '../api/operational_health'
import { timeAgo } from '../lib/formatters'

// ── Platform Metrics types (from Metrics::Recorder snapshot!) ──────────
interface EndpointLatency {
  endpoint: string
  count: number
  p50_ms: number
  p95_ms: number
  p99_ms: number
  max_ms: number
}

interface SseConnectionPayload {
  total: number
  by_stream: Record<string, number>
  recorded_at: string
}

interface FeedLagEntry {
  feed: string
  status: string
  last_poll_at: string | null
  lag_seconds: number | null
  ingested_count: number | null
  error_count: number | null
}

interface AiServiceTiming {
  service: string
  count: number
  p50_ms: number
  p95_ms: number
  max_ms: number
}

function feedStatusIntent(status: string): 'success' | 'danger' | 'warning' | 'none' {
  if (status === 'ok') return 'success'
  if (status === 'error') return 'danger'
  if (status === 'disabled') return 'warning'
  return 'none'
}

function relayStatusIntent(status: string): 'success' | 'danger' | 'warning' | 'none' {
  if (status === 'ok') return 'success'
  if (status === 'error') return 'danger'
  return 'none'
}

const ago = timeAgo

function FeedHealthTable({ feeds }: { feeds: FeedHealthEntry[] }) {
  if (feeds.length === 0) {
    return <p className="bp6-text-muted" style={{ fontSize: 12 }}>No feed health data recorded yet.</p>
  }

  return (
    <HTMLTable compact striped style={{ width: '100%' }}>
      <thead>
        <tr>
          <th>Feed</th>
          <th>Status</th>
          <th>Last Run</th>
          <th>Duration</th>
          <th>Fetched</th>
          <th>Ingested</th>
          <th>Duplicates</th>
          <th>Errors</th>
        </tr>
      </thead>
      <tbody>
        {feeds.map(f => (
          <tr key={f.feed}>
            <td style={{ fontWeight: 600 }}>{f.feed}</td>
            <td>
              <Tag minimal intent={feedStatusIntent(f.status)} style={{ fontSize: 10, fontWeight: 600 }}>
                {f.status.toUpperCase()}
              </Tag>
            </td>
            <td className="bp6-text-muted" style={{ fontSize: 12 }}>
              {ago(f.finished_at)}
            </td>
            <td style={{ fontSize: 12 }}>
              {f.duration_ms < 1000 ? `${f.duration_ms}ms` : `${(f.duration_ms / 1000).toFixed(1)}s`}
            </td>
            <td>{f.fetched_count}</td>
            <td>{f.ingested_count}</td>
            <td>{f.duplicate_count}</td>
            <td>
              {f.error_count > 0 ? (
                <Tag minimal intent="danger" style={{ fontSize: 10 }}>{f.error_count}</Tag>
              ) : (
                <span className="bp6-text-muted">0</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}

function RelayHealthTable({ entries, now }: { entries: OperationalStatusEntry[]; now: number }) {
  const relays = entries.filter(e => e.category === 'relay_health')

  if (relays.length === 0) {
    return <p className="bp6-text-muted" style={{ fontSize: 12 }}>No relay health data recorded yet.</p>
  }

  return (
    <HTMLTable compact striped style={{ width: '100%' }}>
      <thead>
        <tr>
          <th>Relay</th>
          <th>Channel</th>
          <th>Status</th>
          <th>Last Seen</th>
          <th>Heartbeat Expires</th>
        </tr>
      </thead>
      <tbody>
        {relays.map(entry => {
          const p = entry.payload
          const status = (p.status as string) ?? 'unknown'
          const isExpired = p.heartbeat_expires_at
            ? Date.parse(p.heartbeat_expires_at as string) < now
            : false

          return (
            <tr key={entry.key}>
              <td style={{ fontWeight: 600 }}>{(p.relay as string) ?? entry.key}</td>
              <td className="bp6-text-muted">{(p.channel as string) ?? '—'}</td>
              <td>
                <Tag
                  minimal
                  intent={isExpired ? 'danger' : relayStatusIntent(status)}
                  style={{ fontSize: 10, fontWeight: 600 }}
                >
                  {isExpired ? 'STALE' : status.toUpperCase()}
                </Tag>
              </td>
              <td className="bp6-text-muted" style={{ fontSize: 12 }}>
                {p.last_seen_at ? ago(p.last_seen_at as string) : '—'}
              </td>
              <td className="bp6-text-muted" style={{ fontSize: 12 }}>
                {p.heartbeat_expires_at ? ago(p.heartbeat_expires_at as string) : '—'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </HTMLTable>
  )
}

function latencyIntent(ms: number): 'success' | 'warning' | 'danger' {
  if (ms < 200) return 'success'
  if (ms < 1000) return 'warning'
  return 'danger'
}

function lagIntent(seconds: number | null): 'success' | 'warning' | 'danger' {
  if (seconds == null) return 'warning'
  if (seconds < 300) return 'success'
  if (seconds < 900) return 'warning'
  return 'danger'
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function RequestLatencyTable({ endpoints }: { endpoints: EndpointLatency[] }) {
  if (endpoints.length === 0) {
    return <p className="bp6-text-muted" style={{ fontSize: 12 }}>No request latency data yet.</p>
  }

  const maxP95 = Math.max(...endpoints.map(e => e.p95_ms), 1)

  return (
    <HTMLTable compact striped style={{ width: '100%' }}>
      <thead>
        <tr>
          <th>Endpoint</th>
          <th>Requests</th>
          <th>p50</th>
          <th>p95</th>
          <th>p99</th>
          <th>Max</th>
          <th style={{ width: 120 }}>p95 Bar</th>
        </tr>
      </thead>
      <tbody>
        {endpoints.map(e => (
          <tr key={e.endpoint}>
            <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{e.endpoint}</td>
            <td>{e.count}</td>
            <td><Tag minimal intent={latencyIntent(e.p50_ms)} style={{ fontSize: 10 }}>{formatMs(e.p50_ms)}</Tag></td>
            <td><Tag minimal intent={latencyIntent(e.p95_ms)} style={{ fontSize: 10 }}>{formatMs(e.p95_ms)}</Tag></td>
            <td><Tag minimal intent={latencyIntent(e.p99_ms)} style={{ fontSize: 10 }}>{formatMs(e.p99_ms)}</Tag></td>
            <td style={{ fontSize: 11 }}>{formatMs(e.max_ms)}</td>
            <td><ProgressBar value={e.p95_ms / maxP95} intent={latencyIntent(e.p95_ms)} stripes={false} animate={false} /></td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}

function SseConnectionsCard({ payload }: { payload: SseConnectionPayload | null }) {
  if (!payload) {
    return <p className="bp6-text-muted" style={{ fontSize: 12 }}>No SSE connection data yet.</p>
  }

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <div>
        <span className="bp6-text-muted" style={{ fontSize: 11 }}>Total Active</span>
        <div style={{ fontSize: 28, fontWeight: 700, color: payload.total > 0 ? '#3dcc91' : '#a7b6c2' }}>{payload.total}</div>
      </div>
      {Object.entries(payload.by_stream).map(([stream, count]) => (
        <div key={stream}>
          <span className="bp6-text-muted" style={{ fontSize: 11 }}>{stream}</span>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{count}</div>
        </div>
      ))}
      <span className="bp6-text-muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
        {ago(payload.recorded_at)}
      </span>
    </div>
  )
}

function FeedLagTable({ feeds }: { feeds: FeedLagEntry[] }) {
  if (feeds.length === 0) {
    return <p className="bp6-text-muted" style={{ fontSize: 12 }}>No feed lag data yet.</p>
  }

  return (
    <HTMLTable compact striped style={{ width: '100%' }}>
      <thead>
        <tr>
          <th>Feed</th>
          <th>Status</th>
          <th>Lag</th>
          <th>Last Poll</th>
        </tr>
      </thead>
      <tbody>
        {feeds.map(f => (
          <tr key={f.feed}>
            <td style={{ fontWeight: 600 }}>{f.feed}</td>
            <td>
              <Tag minimal intent={feedStatusIntent(f.status)} style={{ fontSize: 10, fontWeight: 600 }}>
                {f.status.toUpperCase()}
              </Tag>
            </td>
            <td>
              <Tag minimal intent={lagIntent(f.lag_seconds)} style={{ fontSize: 10 }}>
                {f.lag_seconds != null ? `${f.lag_seconds}s` : '—'}
              </Tag>
            </td>
            <td className="bp6-text-muted" style={{ fontSize: 12 }}>
              {f.last_poll_at ? ago(f.last_poll_at) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}

function AiResponseTimesTable({ services }: { services: AiServiceTiming[] }) {
  if (services.length === 0) {
    return <p className="bp6-text-muted" style={{ fontSize: 12 }}>No AI service timing data yet.</p>
  }

  return (
    <HTMLTable compact striped style={{ width: '100%' }}>
      <thead>
        <tr>
          <th>Service</th>
          <th>Calls</th>
          <th>p50</th>
          <th>p95</th>
          <th>Max</th>
        </tr>
      </thead>
      <tbody>
        {services.map(s => (
          <tr key={s.service}>
            <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{s.service}</td>
            <td>{s.count}</td>
            <td><Tag minimal intent={latencyIntent(s.p50_ms)} style={{ fontSize: 10 }}>{formatMs(s.p50_ms)}</Tag></td>
            <td><Tag minimal intent={latencyIntent(s.p95_ms)} style={{ fontSize: 10 }}>{formatMs(s.p95_ms)}</Tag></td>
            <td style={{ fontSize: 11 }}>{formatMs(s.max_ms)}</td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}

export default function OperationalHealthPage() {
  const { data: feedData, isPending: feedPending, error: feedError } = useFeedHealth()
  const { data: opsData, isPending: opsPending, error: opsError, dataUpdatedAt } = useOperationalHealth()

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
