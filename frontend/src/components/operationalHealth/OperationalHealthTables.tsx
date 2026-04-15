import { HTMLTable, ProgressBar, Tag } from '@blueprintjs/core'
import type { FeedHealthEntry, OperationalStatusEntry } from '../../api/operational_health'
import { timeAgo } from '../../lib/formatters'

export interface EndpointLatency {
  endpoint: string
  count: number
  p50_ms: number
  p95_ms: number
  p99_ms: number
  max_ms: number
}

export interface SseConnectionPayload {
  total: number
  by_stream: Record<string, number>
  recorded_at: string
}

export interface FeedLagEntry {
  feed: string
  status: string
  last_poll_at: string | null
  lag_seconds: number | null
  ingested_count: number | null
  error_count: number | null
}

export interface AiServiceTiming {
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

export function FeedHealthTable({ feeds }: { feeds: FeedHealthEntry[] }) {
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
        {feeds.map(feed => (
          <tr key={feed.feed}>
            <td style={{ fontWeight: 600 }}>{feed.feed}</td>
            <td>
              <Tag minimal intent={feedStatusIntent(feed.status)} style={{ fontSize: 10, fontWeight: 600 }}>
                {feed.status.toUpperCase()}
              </Tag>
            </td>
            <td className="bp6-text-muted" style={{ fontSize: 12 }}>
              {timeAgo(feed.finished_at)}
            </td>
            <td style={{ fontSize: 12 }}>
              {feed.duration_ms < 1000 ? `${feed.duration_ms}ms` : `${(feed.duration_ms / 1000).toFixed(1)}s`}
            </td>
            <td>{feed.fetched_count}</td>
            <td>{feed.ingested_count}</td>
            <td>{feed.duplicate_count}</td>
            <td>
              {feed.error_count > 0 ? (
                <Tag minimal intent="danger" style={{ fontSize: 10 }}>{feed.error_count}</Tag>
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

export function RelayHealthTable({ entries, now }: { entries: OperationalStatusEntry[]; now: number }) {
  const relays = entries.filter(entry => entry.category === 'relay_health')

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
          const payload = entry.payload
          const status = (payload.status as string) ?? 'unknown'
          const isExpired = payload.heartbeat_expires_at
            ? Date.parse(payload.heartbeat_expires_at as string) < now
            : false

          return (
            <tr key={entry.key}>
              <td style={{ fontWeight: 600 }}>{(payload.relay as string) ?? entry.key}</td>
              <td className="bp6-text-muted">{(payload.channel as string) ?? '—'}</td>
              <td>
                <Tag
                  minimal
                  intent={isExpired ? 'danger' : relayStatusIntent(status)}
                  style={{ fontSize: 10, fontWeight: 600 }}
                >
                  {isExpired ? 'EXPIRED' : status.toUpperCase()}
                </Tag>
              </td>
              <td className="bp6-text-muted" style={{ fontSize: 12 }}>
                {payload.last_seen_at ? timeAgo(payload.last_seen_at as string) : '—'}
              </td>
              <td className="bp6-text-muted" style={{ fontSize: 12 }}>
                {payload.heartbeat_expires_at ? timeAgo(payload.heartbeat_expires_at as string) : '—'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </HTMLTable>
  )
}

export function RequestLatencyTable({ endpoints }: { endpoints: EndpointLatency[] }) {
  if (endpoints.length === 0) {
    return <p className="bp6-text-muted" style={{ fontSize: 12 }}>No request latency data yet.</p>
  }

  const maxP95 = Math.max(...endpoints.map(endpoint => endpoint.p95_ms), 1)

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
        {endpoints.map(endpoint => (
          <tr key={endpoint.endpoint}>
            <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{endpoint.endpoint}</td>
            <td>{endpoint.count}</td>
            <td><Tag minimal intent={latencyIntent(endpoint.p50_ms)} style={{ fontSize: 10 }}>{formatMs(endpoint.p50_ms)}</Tag></td>
            <td><Tag minimal intent={latencyIntent(endpoint.p95_ms)} style={{ fontSize: 10 }}>{formatMs(endpoint.p95_ms)}</Tag></td>
            <td><Tag minimal intent={latencyIntent(endpoint.p99_ms)} style={{ fontSize: 10 }}>{formatMs(endpoint.p99_ms)}</Tag></td>
            <td style={{ fontSize: 11 }}>{formatMs(endpoint.max_ms)}</td>
            <td><ProgressBar value={endpoint.p95_ms / maxP95} intent={latencyIntent(endpoint.p95_ms)} stripes={false} animate={false} /></td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}

export function SseConnectionsCard({ payload }: { payload: SseConnectionPayload | null }) {
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
        {timeAgo(payload.recorded_at)}
      </span>
    </div>
  )
}

export function FeedLagTable({ feeds }: { feeds: FeedLagEntry[] }) {
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
        {feeds.map(feed => (
          <tr key={feed.feed}>
            <td style={{ fontWeight: 600 }}>{feed.feed}</td>
            <td>
              <Tag minimal intent={feedStatusIntent(feed.status)} style={{ fontSize: 10, fontWeight: 600 }}>
                {feed.status.toUpperCase()}
              </Tag>
            </td>
            <td>
              <Tag minimal intent={lagIntent(feed.lag_seconds)} style={{ fontSize: 10 }}>
                {feed.lag_seconds != null ? `${feed.lag_seconds}s` : '—'}
              </Tag>
            </td>
            <td className="bp6-text-muted" style={{ fontSize: 12 }}>
              {feed.last_poll_at ? timeAgo(feed.last_poll_at) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}

export function AiResponseTimesTable({ services }: { services: AiServiceTiming[] }) {
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
        {services.map(service => (
          <tr key={service.service}>
            <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{service.service}</td>
            <td>{service.count}</td>
            <td><Tag minimal intent={latencyIntent(service.p50_ms)} style={{ fontSize: 10 }}>{formatMs(service.p50_ms)}</Tag></td>
            <td><Tag minimal intent={latencyIntent(service.p95_ms)} style={{ fontSize: 10 }}>{formatMs(service.p95_ms)}</Tag></td>
            <td style={{ fontSize: 11 }}>{formatMs(service.max_ms)}</td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}
