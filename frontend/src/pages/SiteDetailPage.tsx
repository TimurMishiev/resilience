import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Button,
  Callout,
  Classes,
  HTMLTable,
  NonIdealState,
  Spinner,
  Tab,
  Tabs,
  Tag,
} from '@blueprintjs/core'
import { useSite } from '../hooks/useSite'
import { useTasks } from '../hooks/useTasks'
import { useSignals } from '../hooks/useSignals'
import { useSignalRuleMatches } from '../hooks/useSignalRuleMatches'
import { useAssets } from '../hooks/useAssets'
import { useReadiness } from '../hooks/useReadiness'
import AuditTimeline from '../components/AuditTimeline'
import type { Task, Signal, SignalRuleMatch, Asset } from '../api/types'

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const PRIORITY_INTENT: Record<string, 'danger' | 'warning' | 'primary' | 'none'> = {
  critical: 'danger', high: 'warning', normal: 'primary', low: 'none',
}

const STATUS_INTENT: Record<string, 'success' | 'warning' | 'danger' | 'none' | 'primary'> = {
  resolved: 'success', blocked: 'danger', in_progress: 'primary', triaged: 'warning', new: 'none',
}

const SIGNAL_ICON: Record<string, string> = {
  aircraft_position: '✈',
  vessel_position: '⛵',
  seismic_event: '🌊',
  gps_jamming: '📡',
  wildfire: '🔥',
  manual: '⚡',
}

// ── sub-panels ────────────────────────────────────────────────────────────────

function TasksTab({ siteId }: { siteId: string }) {
  const { data, isPending, error } = useTasks({ site_id: siteId, per_page: 50 })

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (error) return <Callout intent="danger" compact>{error.message}</Callout>

  const tasks = data?.data ?? []

  if (tasks.length === 0) {
    return (
      <NonIdealState
        icon="tick-circle"
        title="No tasks"
        description="No tasks linked to this site."
        className="tab-empty-state"
      />
    )
  }

  return (
    <HTMLTable className="data-table" striped>
      <thead>
        <tr>
          <th>Title</th>
          <th>Priority</th>
          <th>Status</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t: Task) => (
          <tr key={t.id}>
            <td>{t.title}</td>
            <td>
              <Tag minimal intent={PRIORITY_INTENT[t.priority] ?? 'none'}>
                {t.priority}
              </Tag>
            </td>
            <td>
              <Tag minimal intent={STATUS_INTENT[t.workflow_status] ?? 'none'}>
                {t.workflow_status.replace('_', ' ')}
              </Tag>
            </td>
            <td className="mono">{fmt(t.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}

function SignalsTab({ siteId }: { siteId: string }) {
  const { data, isPending, error } = useSignals({ site_id: siteId, per_page: 50 })

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (error) return <Callout intent="danger" compact>{error.message}</Callout>

  const signals = data?.data ?? []

  if (signals.length === 0) {
    return (
      <NonIdealState
        icon="signal-search"
        title="No signals"
        description="No signals detected near this site."
        className="tab-empty-state"
      />
    )
  }

  return (
    <HTMLTable className="data-table" striped>
      <thead>
        <tr>
          <th>Type</th>
          <th>Source</th>
          <th>Magnitude</th>
          <th>Lat / Lng</th>
          <th>Occurred</th>
        </tr>
      </thead>
      <tbody>
        {signals.map((s: Signal) => (
          <tr key={s.id}>
            <td>
              <span style={{ marginRight: 6 }}>{SIGNAL_ICON[s.signal_type] ?? '•'}</span>
              {s.signal_type.replace(/_/g, ' ')}
            </td>
            <td className="mono">{s.source}</td>
            <td className="mono">{s.magnitude != null ? Number(s.magnitude).toFixed(2) : '—'}</td>
            <td className="mono">
              {Number(s.lat).toFixed(3)}, {Number(s.lng).toFixed(3)}
            </td>
            <td className="mono">{fmt(s.occurred_at)}</td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}

function RuleFiresTab({ siteId }: { siteId: string }) {
  const { data, isPending, error } = useSignalRuleMatches({ site_id: siteId, per_page: 50 })

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (error) return <Callout intent="danger" compact>{error.message}</Callout>

  const matches = data?.data ?? []

  if (matches.length === 0) {
    return (
      <NonIdealState
        icon="shield"
        title="No rule fires"
        description="No correlation rules have fired for this site."
        className="tab-empty-state"
      />
    )
  }

  return (
    <HTMLTable className="data-table" striped>
      <thead>
        <tr>
          <th>Rule</th>
          <th>Signal</th>
          <th>Actions</th>
          <th>Distance</th>
          <th>Fired</th>
        </tr>
      </thead>
      <tbody>
        {matches.map((m: SignalRuleMatch) => {
          const actions = (m.metadata?.actions_taken as string[] | undefined) ?? []
          const distKm = m.metadata?.distance_km as number | undefined
          return (
            <tr key={m.id}>
              <td>{m.correlation_rule?.name ?? <span className="bp6-text-muted">—</span>}</td>
              <td className="mono">
                {m.signal
                  ? `${SIGNAL_ICON[m.signal.signal_type] ?? ''} ${m.signal.signal_type.replace(/_/g, ' ')}`
                  : <span className="bp6-text-muted">—</span>}
              </td>
              <td>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {actions.length > 0
                    ? actions.map((a) => (
                        <Tag key={a} minimal intent="warning" style={{ fontSize: 11 }}>
                          {a.replace(/_/g, ' ')}
                        </Tag>
                      ))
                    : <span className="bp6-text-muted">—</span>}
                </div>
              </td>
              <td className="mono">{distKm != null ? `${Number(distKm).toFixed(1)} km` : '—'}</td>
              <td className="mono">{fmt(m.fired_at)}</td>
            </tr>
          )
        })}
      </tbody>
    </HTMLTable>
  )
}

function AssetsTab({ siteId }: { siteId: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isPending, error } = useAssets({ home_site_id: siteId, per_page: 50 } as any)

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (error) return <Callout intent="danger" compact>{error.message}</Callout>

  const assets = data?.data ?? []

  if (assets.length === 0) {
    return (
      <NonIdealState
        icon="box"
        title="No assets"
        description="No assets assigned to this site."
        className="tab-empty-state"
      />
    )
  }

  const STATUS_COLOR: Record<string, 'success' | 'warning' | 'danger' | 'none'> = {
    available: 'success', in_use: 'primary' as never, maintenance: 'warning', offline: 'danger',
  }

  return (
    <HTMLTable className="data-table" striped>
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {assets.map((a: Asset) => (
          <tr key={a.id}>
            <td>{a.name}</td>
            <td className="mono">{a.asset_type}</td>
            <td>
              <Tag minimal intent={STATUS_COLOR[a.status] ?? 'none'}>
                {a.status.replace('_', ' ')}
              </Tag>
            </td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function SiteDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<string>('tasks')

  const { data: site, isPending, error } = useSite(id)
  const { data: readinessData } = useReadiness()
  const readiness = readinessData?.find((r) => r.site_id === id) ?? null

  if (isPending) {
    return (
      <div className="page-content">
        <div className="page-header">
          <span className={Classes.SKELETON} style={{ width: 220, height: 24, display: 'inline-block' }} />
        </div>
        <Spinner size={24} />
      </div>
    )
  }

  if (error || !site) {
    return (
      <div className="page-content">
        <Callout intent="danger" title="Failed to load site">
          {error?.message ?? 'Site not found'}
        </Callout>
      </div>
    )
  }

  const readinessScore = readiness?.score ?? null
  const readinessIntent =
    readinessScore == null ? 'none'
    : readinessScore >= 0.8 ? 'success'
    : readinessScore >= 0.5 ? 'warning'
    : 'danger'

  return (
    <div className="page-content site-detail">
      {/* ── header ── */}
      <div className="site-detail-header">
        <Button
          icon="arrow-left"
          minimal
          small
          onClick={() => navigate('/sites')}
          style={{ marginRight: 4 }}
        />
        <h2 className="bp6-heading" style={{ margin: 0 }}>{site.name}</h2>

        <Tag minimal intent={site.status === 'active' ? 'success' : 'none'} style={{ marginLeft: 6 }}>
          {site.status}
        </Tag>

        {site.flagged_at && (
          <Tag minimal intent="danger" icon="flag" title={site.flag_reason ?? 'Flagged'}>
            flagged
          </Tag>
        )}

        {readinessScore != null && (
          <Tag minimal intent={readinessIntent} style={{ marginLeft: 'auto' }}>
            Readiness {Math.round(readinessScore * 100)}%
          </Tag>
        )}
      </div>

      {/* ── meta row ── */}
      <div className="site-detail-meta">
        <span className="bp6-text-muted mono">
          {Number(site.latitude).toFixed(4)}, {Number(site.longitude).toFixed(4)}
        </span>
        {site.flagged_at && site.flag_reason && (
          <Callout intent="danger" compact style={{ marginTop: 10 }}>
            <strong>Flag reason:</strong> {site.flag_reason}
          </Callout>
        )}
        {readiness && (
          <div className="site-readiness-row">
            <span className="bp6-text-muted" style={{ fontSize: 12 }}>
              {readiness.counts.resolved}/{readiness.counts.total} tasks resolved
              {readiness.counts.blocked > 0 && ` · ${readiness.counts.blocked} blocked`}
            </span>
          </div>
        )}
      </div>

      {/* ── tabs ── */}
      <Tabs
        id="site-detail-tabs"
        selectedTabId={tab}
        onChange={(t) => setTab(String(t))}
        className="site-detail-tabs"
      >
        <Tab id="tasks" title="Tasks" panel={<TasksTab siteId={site.id} />} />
        <Tab id="signals" title="Signals" panel={<SignalsTab siteId={site.id} />} />
        <Tab id="rule_fires" title="Rule Fires" panel={<RuleFiresTab siteId={site.id} />} />
        <Tab id="assets" title="Assets" panel={<AssetsTab siteId={site.id} />} />
        <Tab id="audit" title="Audit Trail" panel={
          <div style={{ paddingTop: 12 }}>
            <AuditTimeline entityType="Site" entityId={site.id} />
          </div>
        } />
      </Tabs>
    </div>
  )
}
