import { Callout, Classes, HTMLTable, Icon, Tag } from '@blueprintjs/core'
import { useFeedHealth, useOperationalHealth } from '../hooks/useOperationalHealth'
import type { FeedHealthEntry, OperationalStatusEntry } from '../api/operational_health'

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

function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  if (ms < 0) return 'just now'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m ago`
}

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

function RelayHealthTable({ entries }: { entries: OperationalStatusEntry[] }) {
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
            ? Date.parse(p.heartbeat_expires_at as string) < Date.now()
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

export default function OperationalHealthPage() {
  const { data: feedData, isPending: feedPending, error: feedError } = useFeedHealth()
  const { data: opsData, isPending: opsPending, error: opsError } = useOperationalHealth()

  const feeds = feedData?.data ?? []
  const opsEntries = opsData?.data ?? []

  const okFeeds = feeds.filter(f => f.status === 'ok').length
  const errorFeeds = feeds.filter(f => f.status === 'error' || f.status === 'disabled').length
  const relayEntries = opsEntries.filter(e => e.category === 'relay_health')
  const staleRelays = relayEntries.filter(e => {
    const expires = e.payload.heartbeat_expires_at as string | undefined
    return expires ? Date.parse(expires) < Date.now() : false
  }).length

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
          <RelayHealthTable entries={opsEntries} />
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
