import { useState, useMemo } from 'react'
import { Button, Callout, Checkbox, Classes, Icon, Tag, Tooltip } from '@blueprintjs/core'
import AlertChainDrawer from '../components/AlertChainDrawer'
import RecommendationCard from '../components/RecommendationCard'
import EvidenceDrawer from '../components/EvidenceDrawer'
import { useNavigate } from 'react-router-dom'
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from 'recharts'
import { useReadiness, useThroughput } from '../hooks/useReadiness'
import { useRiskScores } from '../hooks/useRiskScores'
import { useTasks } from '../hooks/useTasks'
import { useSignalRuleMatches, useTransitionAlert, useBulkTransitionAlerts } from '../hooks/useSignalRuleMatches'
import { useVessels } from '../hooks/useVessels'
import { useReplay } from '../context/ReplayContext'
import { useRole } from '../hooks/useRole'
import { useRecommendations } from '../hooks/useRecommendations'
import type { Recommendation } from '../api/recommendations'
import type { Vessel } from '../api/vessels'
import type { WorkflowStatus, TaskPriority, SignalRuleMatch, AlertStatus, RiskLevel } from '../api/types'
import { SIGNAL_ICON_NAME } from '../lib/signalIcons'
import { humanize } from '../utils/humanize'
import { COLORS } from '../lib/colors'

const STATUS_ORDER: WorkflowStatus[] = ['new', 'triaged', 'in_progress', 'blocked', 'resolved']
const PRIORITY_ORDER: TaskPriority[] = ['critical', 'high', 'normal', 'low']

const STATUS_COLOR: Record<WorkflowStatus, string> = {
  new:         COLORS.muted,
  triaged:     COLORS.warning,
  in_progress: COLORS.primary,
  blocked:     COLORS.danger,
  resolved:    COLORS.success,
}

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  critical: COLORS.danger,
  high:     COLORS.warning,
  normal:   COLORS.primary,
  low:      COLORS.subtle,
}

function scoreIntent(score: number | null) {
  if (score === null) return COLORS.subtle
  if (score >= 0.75) return COLORS.success
  if (score >= 0.5)  return COLORS.warning
  return COLORS.danger
}

function pct(n: number | null): string {
  if (n === null) return '—'
  return `${Math.round(n * 100)}%`
}

const RISK_COLOR: Record<RiskLevel, string> = {
  low:      COLORS.success,
  moderate: COLORS.warning,
  high:     COLORS.orange,
  critical: COLORS.danger,
}

const RISK_LABEL: Record<RiskLevel, string> = {
  low:      'LOW',
  moderate: 'MOD',
  high:     'HIGH',
  critical: 'CRIT',
}

const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  unacknowledged: 'New',
  acknowledged:   'Ack',
  investigating:  'Inv',
  closed:         'Done',
}

const ALERT_STATUS_INTENT: Record<AlertStatus, 'danger' | 'warning' | 'primary' | 'success'> = {
  unacknowledged: 'danger',
  acknowledged:   'warning',
  investigating:  'primary',
  closed:         'success',
}

function confidenceColor(c: number): string {
  if (c >= 0.85) return COLORS.success
  if (c >= 0.65) return COLORS.warning
  if (c >= 0.40) return COLORS.orange
  return COLORS.danger
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtLoiteringDuration(iso: string | null): string {
  if (!iso) return '—'

  const minutes = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`
}

function LoiteringWatchlist({ vessels }: { vessels: Vessel[] }) {
  if (vessels.length === 0) {
    return (
      <p className="bp6-text-muted" style={{ fontSize: 12, margin: 0 }}>
        No vessels are currently flagged as loitering.
      </p>
    )
  }

  return (
    <div className="alerts-list">
      {vessels.map(vessel => (
        <div key={vessel.id} className="alert-row alert-row--warning">
          <div className="alert-row-main" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="alert-row-left">
              <span className="alert-signal-icon">
                <Icon icon="satellite" size={14} />
              </span>
              <div className="alert-body">
                <span className="alert-rule-name">{vessel.name ?? vessel.mmsi}</span>
                <span className="alert-site bp6-text-muted">
                  {vessel.mmsi}
                  {vessel.flag ? ` · ${vessel.flag}` : ''}
                  {vessel.vessel_type ? ` · ${vessel.vessel_type}` : ''}
                </span>
              </div>
            </div>
            <div className="alert-row-right">
              <div className="alert-actions" style={{ alignItems: 'flex-end' }}>
                <Tag minimal intent="warning" style={{ fontSize: 10, fontWeight: 600 }}>
                  Loitering {fmtLoiteringDuration(vessel.loitering_since)}
                </Tag>
                {vessel.dark && (
                  <Tag minimal intent="danger" style={{ fontSize: 10, fontWeight: 600 }}>
                    Dark
                  </Tag>
                )}
              </div>
              <span className="bp6-text-muted" style={{ fontSize: 11 }}>
                Last seen {fmtTime(vessel.last_seen_at)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

type AlertTransition = { label: string; to: AlertStatus; intent: 'primary' | 'warning' | 'none' | 'danger' }

const ALERT_TRANSITIONS: Record<AlertStatus, AlertTransition[]> = {
  unacknowledged: [
    { label: 'Acknowledge', to: 'acknowledged',  intent: 'primary' },
    { label: 'Investigate', to: 'investigating', intent: 'warning' },
    { label: 'Close',       to: 'closed',        intent: 'none'    },
  ],
  acknowledged: [
    { label: 'Investigate', to: 'investigating', intent: 'warning' },
    { label: 'Close',       to: 'closed',        intent: 'none'    },
    { label: 'Reopen',      to: 'unacknowledged', intent: 'none'   },
  ],
  investigating: [
    { label: 'Close',       to: 'closed',        intent: 'none'    },
    { label: 'Acknowledge', to: 'acknowledged',  intent: 'primary' },
  ],
  closed: [
    { label: 'Reopen',      to: 'unacknowledged', intent: 'none'   },
    { label: 'Investigate', to: 'investigating', intent: 'warning' },
  ],
}

// Bulk-triageable statuses — the three actions operators most commonly apply in volume.
// The backend enforces per-alert transition validity; invalid ones go to `failed`.
const BULK_ACTIONS = [
  { to_status: 'acknowledged', label: 'Acknowledge', intent: 'success'  },
  { to_status: 'investigating', label: 'Investigate', intent: 'warning'  },
  { to_status: 'closed',        label: 'Close',       intent: 'danger'   },
] as const

function AlertsPanel({ matches }: { matches: SignalRuleMatch[] }) {
  const navigate    = useNavigate()
  const transition  = useTransitionAlert()
  const bulkMutate  = useBulkTransitionAlerts()
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [chainMatch, setChainMatch] = useState<SignalRuleMatch | null>(null)

  if (matches.length === 0) {
    return <p className="bp6-text-muted" style={{ fontSize: 13, margin: 0 }}>No rule fires recorded yet.</p>
  }

  const allIds      = matches.map(m => m.id)
  const allSelected = selected.size === matches.length
  const someSelected = selected.size > 0

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds))
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  function handleBulk(to_status: string) {
    bulkMutate.mutate(
      { ids: Array.from(selected), to_status },
      { onSuccess: () => setSelected(new Set()) }
    )
  }

  return (
    <div className="alerts-list">
      {/* Bulk action toolbar — shown when any alerts are selected */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, minHeight: 28 }}>
        <Checkbox
          checked={allSelected}
          indeterminate={someSelected && !allSelected}
          onChange={toggleAll}
          style={{ margin: 0 }}
        />
        {someSelected ? (
          <>
            <span style={{ fontSize: 12, color: COLORS.muted }}>{selected.size} selected</span>
            {BULK_ACTIONS.map(action => (
              <Button
                key={action.to_status}
                small minimal
                intent={action.intent as 'success' | 'warning' | 'danger'}
                loading={bulkMutate.isPending}
                onClick={() => handleBulk(action.to_status)}
                style={{ fontSize: 11 }}
              >
                {action.label}
              </Button>
            ))}
            <Button small minimal onClick={() => setSelected(new Set())} style={{ fontSize: 11 }}>
              Clear
            </Button>
          </>
        ) : (
          <span style={{ fontSize: 12, color: COLORS.subtle }}>Select alerts to bulk-triage</span>
        )}
      </div>

      {matches.map((m) => {
        const actions  = (m.metadata?.actions_taken as string[] | undefined) ?? []
        const hasFlag  = actions.some((a) => a.includes('flag'))
        const hasTask  = actions.some((a) => a.includes('task'))
        const distKm   = m.metadata?.distance_km as number | undefined
        const intent   = hasFlag ? 'danger' : hasTask ? 'warning' : 'none'
        const status   = (m.workflow_status ?? 'unacknowledged') as AlertStatus
        const conf     = typeof m.confidence === 'number' ? m.confidence : null
        const txBtns   = ALERT_TRANSITIONS[status] ?? []
        const isChecked = selected.has(m.id)

        return (
          <div key={m.id} className={`alert-row alert-row--${intent}${isChecked ? ' alert-row--selected' : ''}`}>
            {/* Main card body */}
            <div
              className="alert-row-main"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              {/* Checkbox — stops click propagation so it doesn't trigger navigation */}
              <div onClick={e => e.stopPropagation()} style={{ paddingRight: 6 }}>
                <Checkbox checked={isChecked} onChange={() => toggleOne(m.id)} style={{ margin: 0 }} />
              </div>

              <div
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                         cursor: m.site?.id ? 'pointer' : 'default' }}
                onClick={() => m.site?.id && navigate(`/sites/${m.site.id}`)}
              >
                <div className="alert-row-left">
                  <span className="alert-signal-icon">
                    {m.signal
                      ? <Icon icon={SIGNAL_ICON_NAME[m.signal.signal_type] ?? 'dot'} size={14} />
                      : <Icon icon="dot" size={14} />}
                  </span>
                  <div className="alert-body">
                    <span className="alert-rule-name">
                      {m.correlation_rule?.name ?? (
                        m.metadata?.geofence_breach
                          ? <Tag minimal intent="primary" icon="locate" style={{ fontSize: 10 }}>Geofence breach</Tag>
                          : 'Unknown rule'
                      )}
                    </span>
                    {m.site && (
                      <span className="alert-site bp6-text-muted">@ {m.site.name}</span>
                    )}
                  </div>
                </div>
                <div className="alert-row-right">
                  <div className="alert-actions">
                    <Tag minimal intent={ALERT_STATUS_INTENT[status] ?? 'none'}
                         style={{ fontSize: 10, fontWeight: 600 }}>
                      {ALERT_STATUS_LABEL[status] ?? status}
                    </Tag>
                    {conf != null && (
                      <Tooltip content={`Match confidence: ${Math.round(conf * 100)}%`} placement="top">
                        <span className="alert-confidence"
                              style={{ color: confidenceColor(conf), fontSize: 11, fontWeight: 600, cursor: 'default' }}>
                          {Math.round(conf * 100)}%
                        </span>
                      </Tooltip>
                    )}
                    {actions.map((a) => (
                      <Tag key={a} minimal intent={hasFlag ? 'danger' : 'warning'} style={{ fontSize: 10 }}>
                        {humanize(a)}
                      </Tag>
                    ))}
                    {distKm != null && (
                      <span className="bp6-text-muted" style={{ fontSize: 11 }}>{Number(distKm).toFixed(0)} km</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span className="alert-time bp6-text-muted">{fmtTime(m.fired_at)}</span>
                    <Button
                      icon="data-lineage"
                      minimal
                      small
                      title="View intelligence chain"
                      onClick={e => { e.stopPropagation(); setChainMatch(m) }}
                      style={{ minWidth: 0, minHeight: 0, opacity: 0.6 }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Inline single-alert transition row — hidden when bulk selection is active */}
            {txBtns.length > 0 && !someSelected && (
              <div className="alert-row-transitions" onClick={e => e.stopPropagation()}
                   style={{ display: 'flex', gap: 4, padding: '4px 8px 6px 46px' }}>
                {txBtns.map((btn) => (
                  <Button key={btn.to} small minimal intent={btn.intent}
                          disabled={transition.isPending}
                          onClick={() => transition.mutate({ id: m.id, body: { to_status: btn.to } })}
                          style={{ fontSize: 11 }}>
                    {btn.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <AlertChainDrawer match={chainMatch} onClose={() => setChainMatch(null)} />
    </div>
  )
}

export default function DashboardPage() {
  const { asOf, isReplaying } = useReplay()
  const navigate  = useNavigate()
  const { isCommander } = useRole()
  const [evidenceRec, setEvidenceRec] = useState<Recommendation | null>(null)

  const { data: recData, error: recError } = useRecommendations(undefined, { enabled: !isReplaying, refetchInterval: isReplaying ? false : 60_000 })
  const topRecs = (recData?.data ?? []).slice(0, 3)

  const { data: matchesRes, error: matchesError } = useSignalRuleMatches({ per_page: 15 }, { enabled: !isReplaying, refetchInterval: isReplaying ? false : 10_000 })
  const recentMatches = matchesRes?.data ?? []

  const { data: riskData } = useRiskScores({ enabled: !isReplaying, refetchInterval: isReplaying ? false : 60_000 })
  const riskBySite = useMemo(
    () => (isReplaying ? {} : Object.fromEntries((riskData ?? []).map((r) => [r.site_id, r]))),
    [isReplaying, riskData]
  )

  const { data: readinessData, isPending: readinessPending, error: readinessError } = useReadiness(
    asOf ? { as_of: asOf } : undefined
  )
  const { data: taskRes, isPending: tasksPending, error: tasksError } = useTasks({
    per_page: 500,
    ...(asOf ? { as_of: asOf } : {}),
  })
  const { data: throughputRes } = useThroughput({ enabled: !isReplaying })
  const {
    data: loiteringRes,
    isPending: loiteringPending,
    error: loiteringError,
  } = useVessels(
    { loitering: true, per_page: 8 },
    { enabled: !isReplaying },
  )

  const tasks       = taskRes?.data ?? []
  const readiness   = readinessData ?? []
  const throughput  = throughputRes?.data ?? []
  const loiteringVessels = loiteringRes?.data ?? []

  // Aggregate task counts
  const statusCounts = STATUS_ORDER.map((s) => ({
    status: humanize(s),
    count:  tasks.filter((t) => t.workflow_status === s).length,
    fill:   STATUS_COLOR[s],
  }))

  const priorityCounts = PRIORITY_ORDER.map((p) => ({
    priority: p,
    count:    tasks.filter((t) => t.priority === p).length,
    fill:     PRIORITY_COLOR[p],
  }))

  const loading = readinessPending || tasksPending

  const totalTasks    = tasks.length
  const resolvedCount = tasks.filter((t) => t.workflow_status === 'resolved').length
  const blockedCount  = tasks.filter((t) => t.workflow_status === 'blocked').length
  const avgReadiness  = readiness.length > 0
    ? readiness.reduce((sum, s) => sum + (s.score ?? 0), 0) / readiness.length
    : null

  if (readinessError) {
    return (
      <div className="page-content">
        <Callout intent="danger" title="Failed to load dashboard">{readinessError.message}</Callout>
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <h2 className="bp6-heading">Dashboard</h2>
      </div>

      {isReplaying && (
        <Callout intent="warning" icon="history" compact style={{ marginBottom: 16 }}>
          Recent alerts, recommendations, throughput analytics, and risk-score badges are hidden during replay because those widgets are only available as live state.
        </Callout>
      )}

      {/* KPI row */}
      <div className="dashboard-kpi-row">
        <div className="dashboard-kpi">
          <span className="dashboard-kpi-label bp6-text-muted">Total Tasks</span>
          <span className="dashboard-kpi-value">
            {loading ? <span className={Classes.SKELETON} style={{ width: 40, display: 'inline-block' }}>&nbsp;</span> : totalTasks}
          </span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi-label bp6-text-muted">Resolved</span>
          <span className="dashboard-kpi-value" style={{ color: COLORS.success }}>
            {loading ? <span className={Classes.SKELETON} style={{ width: 56, display: 'inline-block' }}>&nbsp;</span> : (
              <>
                {resolvedCount}
                <span className="dashboard-kpi-sub">
                  {totalTasks > 0 ? ` (${Math.round(resolvedCount / totalTasks * 100)}%)` : ''}
                </span>
              </>
            )}
          </span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi-label bp6-text-muted">Blocked</span>
          <span className="dashboard-kpi-value" style={{ color: blockedCount > 0 ? COLORS.danger : COLORS.success }}>
            {loading ? <span className={Classes.SKELETON} style={{ width: 32, display: 'inline-block' }}>&nbsp;</span> : blockedCount}
          </span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi-label bp6-text-muted">Avg Readiness</span>
          <span className="dashboard-kpi-value" style={{ color: scoreIntent(avgReadiness) }}>
            {loading ? <span className={Classes.SKELETON} style={{ width: 48, display: 'inline-block' }}>&nbsp;</span> : pct(avgReadiness)}
          </span>
        </div>
      </div>

      <div className="dashboard-grid">
        {/* Site readiness */}
        <div className="dashboard-card">
          <h4 className="dashboard-card-title bp6-heading">Site Readiness</h4>
          {loading ? (
            <div className="readiness-list">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="readiness-row">
                  <span className={`readiness-name ${Classes.SKELETON}`} style={{ width: 80 }}>&nbsp;</span>
                  <div className="readiness-bar-track">
                    <div className={Classes.SKELETON} style={{ width: '60%', height: '100%' }}>&nbsp;</div>
                  </div>
                  <span className={Classes.SKELETON} style={{ width: 36, display: 'inline-block' }}>&nbsp;</span>
                  <div className={Classes.SKELETON} style={{ width: 28 }}>&nbsp;</div>
                </div>
              ))}
            </div>
          ) : readiness.length === 0 ? (
            <p className="bp6-text-muted">No sites.</p>
          ) : (
            <div className="readiness-list">
              {readiness.map((s) => {
                const risk = riskBySite[s.site_id]
                return (
                  <div key={s.site_id} className="readiness-row">
                    <span className="readiness-name">{s.site_name}</span>
                    <div className="readiness-bar-track">
                      <div
                        className="readiness-bar-fill"
                        style={{
                          width: `${Math.round((s.score ?? 0) * 100)}%`,
                          backgroundColor: scoreIntent(s.score),
                        }}
                      />
                    </div>
                    <span className="readiness-pct" style={{ color: scoreIntent(s.score) }}>
                      {pct(s.score)}
                    </span>
                    <div className="readiness-counts">
                      <Tag minimal intent="success" style={{ fontSize: 10 }}>{s.counts.resolved}R</Tag>
                      {s.counts.blocked > 0 && (
                        <Tag minimal intent="danger" style={{ fontSize: 10 }}>{s.counts.blocked}B</Tag>
                      )}
                    </div>
                    {risk && (
                      <Tooltip
                        content={
                          <span style={{ fontSize: 11, lineHeight: 1.6 }}>
                            <strong>Risk Score: {risk.score}/100</strong><br />
                            Alerts: {risk.components.alert_pressure.toFixed(1)}&nbsp;·&nbsp;
                            Tasks: {risk.components.task_health.toFixed(1)}&nbsp;·&nbsp;
                            Signals: {risk.components.signal_density.toFixed(1)}
                          </span>
                        }
                        placement="top"
                      >
                        <Tag
                          minimal
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: RISK_COLOR[risk.risk_level],
                            borderColor: RISK_COLOR[risk.risk_level],
                            cursor: 'default',
                            letterSpacing: '0.04em',
                          }}
                        >
                          {RISK_LABEL[risk.risk_level]}
                        </Tag>
                      </Tooltip>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Task status breakdown */}
        <div className="dashboard-card">
          <h4 className="dashboard-card-title bp6-heading">Tasks by Status</h4>
          {tasksError && <Callout intent="danger" compact>{tasksError.message}</Callout>}
          {loading ? (
            <div className={Classes.SKELETON} style={{ width: '100%', height: 180 }}>&nbsp;</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={statusCounts} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <XAxis dataKey="status" tick={{ fill: COLORS.muted, fontSize: 11 }} />
                <YAxis tick={{ fill: COLORS.muted, fontSize: 11 }} allowDecimals={false} />
                <ChartTooltip
                  contentStyle={{ background: COLORS.chartBg, border: `1px solid ${COLORS.chartBorder}`, fontSize: 12 }}
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {statusCounts.map((entry) => (
                    <Cell key={entry.status} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Task priority breakdown */}
        <div className="dashboard-card">
          <h4 className="dashboard-card-title bp6-heading">Tasks by Priority</h4>
          {loading ? (
            <div className={Classes.SKELETON} style={{ width: '100%', height: 180 }}>&nbsp;</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={priorityCounts} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <XAxis dataKey="priority" tick={{ fill: COLORS.muted, fontSize: 11 }} />
                <YAxis tick={{ fill: COLORS.muted, fontSize: 11 }} allowDecimals={false} />
                <ChartTooltip
                  contentStyle={{ background: COLORS.chartBg, border: `1px solid ${COLORS.chartBorder}`, fontSize: 12 }}
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {priorityCounts.map((entry) => (
                    <Cell key={entry.priority} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {!isReplaying && (
          <>
            {/* Recent alerts — rule fires */}
            <div className="dashboard-card dashboard-card--wide">
              <div className="dashboard-card-header">
                <h4 className="dashboard-card-title bp6-heading">Recent Alerts</h4>
                <span className="bp6-text-muted" style={{ fontSize: 11 }}>auto-refreshes · click to open site</span>
              </div>
              {matchesError && <Callout intent="danger" compact>{matchesError.message}</Callout>}
              <AlertsPanel matches={recentMatches} />
            </div>

            {/* Recommendations panel */}
            <div className="dashboard-card dashboard-card--wide">
              <div className="dashboard-card-header">
                <h4 className="dashboard-card-title bp6-heading">
                  <Icon icon="lightbulb" size={14} style={{ marginRight: 6 }} />
                  Recommendations
                </h4>
                <Button minimal small onClick={() => navigate('/recommendations')} style={{ fontSize: 11 }}>
                  View all →
                </Button>
              </div>
              {recError && <Callout intent="danger" compact>{recError.message}</Callout>}
              {topRecs.length === 0 ? (
                <p className="bp6-text-muted" style={{ fontSize: 12, margin: 0 }}>
                  No active recommendations. System analyses operational state every 30 minutes.
                </p>
              ) : (
                topRecs.map(rec => (
                  <RecommendationCard
                    key={rec.id}
                    rec={rec}
                    onViewEvidence={setEvidenceRec}
                    isCommander={isCommander}
                  />
                ))
              )}
            </div>

            <div className="dashboard-card dashboard-card--wide">
              <div className="dashboard-card-header">
                <h4 className="dashboard-card-title bp6-heading">
                  <Icon icon="satellite" size={14} style={{ marginRight: 6 }} />
                  Loitering Watchlist
                </h4>
                <span className="bp6-text-muted" style={{ fontSize: 11 }}>
                  auto-refreshes · dwell &gt; 30m within 3 km
                </span>
              </div>
              {loiteringPending ? (
                <div className={Classes.SKELETON} style={{ width: '100%', height: 120 }}>&nbsp;</div>
              ) : loiteringError ? (
                <Callout intent="danger" compact>
                  Failed to load loitering watchlist{loiteringError.message ? `: ${loiteringError.message}` : '.'}
                </Callout>
              ) : (
                <LoiteringWatchlist vessels={loiteringVessels} />
              )}
            </div>

            {/* Throughput — resolved tasks per day */}
            <div className="dashboard-card dashboard-card--wide">
              <h4 className="dashboard-card-title bp6-heading">Resolution Throughput — Last 30 Days</h4>
              {loading ? (
                <div className={Classes.SKELETON} style={{ width: '100%', height: 180 }}>&nbsp;</div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={throughput} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: COLORS.muted, fontSize: 10 }}
                      tickFormatter={(d: string) => d.slice(5)} // MM-DD
                      interval={4}
                    />
                    <YAxis tick={{ fill: COLORS.muted, fontSize: 11 }} allowDecimals={false} />
                    <ChartTooltip
                      contentStyle={{ background: COLORS.chartBg, border: `1px solid ${COLORS.chartBorder}`, fontSize: 12 }}
                      labelFormatter={(d) => String(d)}
                    />
                    <Line
                      type="monotone"
                      dataKey="resolved"
                      stroke={COLORS.success}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: COLORS.success }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </>
        )}
      </div>

      {!isReplaying && <EvidenceDrawer rec={evidenceRec} onClose={() => setEvidenceRec(null)} />}
    </div>
  )
}
