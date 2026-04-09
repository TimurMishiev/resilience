import { useState, useMemo } from 'react'
import { Button, Callout, Classes, Icon, Tag, Tooltip } from '@blueprintjs/core'
import ExportDialog from '../components/ExportDialog'
import AlertsPanel from '../components/dashboard/AlertsPanel'
import LoiteringWatchlist from '../components/dashboard/LoiteringWatchlist'
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
import { useSignalRuleMatches } from '../hooks/useSignalRuleMatches'
import { useVessels } from '../hooks/useVessels'
import { useReplay } from '../context/ReplayContext'
import { useRole } from '../hooks/useRole'
import { useRecommendations } from '../hooks/useRecommendations'
import type { Recommendation } from '../api/recommendations'
import type { WorkflowStatus, TaskPriority, RiskLevel } from '../api/types'
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

export default function DashboardPage() {
  const { asOf, isReplaying } = useReplay()
  const navigate  = useNavigate()
  const { isCommander } = useRole()
  const [evidenceRec, setEvidenceRec] = useState<Recommendation | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const replayParams = asOf ? { as_of: asOf } : undefined

  const { data: recData, error: recError } = useRecommendations(replayParams, { refetchInterval: isReplaying ? false : 60_000 })
  const topRecs = (recData?.data ?? []).slice(0, 3)

  const { data: matchesRes, error: matchesError } = useSignalRuleMatches({ per_page: 15, ...(replayParams ?? {}) }, { refetchInterval: isReplaying ? false : 10_000 })
  const recentMatches = matchesRes?.data ?? []

  const { data: riskData } = useRiskScores(replayParams, { refetchInterval: isReplaying ? false : 60_000 })
  const riskBySite = useMemo(
    () => Object.fromEntries((riskData ?? []).map((r) => [r.site_id, r])),
    [riskData]
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
        <Button small icon="export" text="Export Data" onClick={() => setExportOpen(true)} />
      </div>

      {isReplaying && (
        <Callout intent="warning" icon="history" compact style={{ marginBottom: 16 }}>
          Viewing historical dashboard state at the replay timestamp. Throughput analytics and the loitering watchlist remain live-only.
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

        <>
          {/* Recent alerts — rule fires */}
          <div className="dashboard-card dashboard-card--wide">
            <div className="dashboard-card-header">
              <h4 className="dashboard-card-title bp6-heading">Recent Alerts</h4>
              <span className="bp6-text-muted" style={{ fontSize: 11 }}>
                {isReplaying ? 'historical snapshot' : 'auto-refreshes · click to open site'}
              </span>
            </div>
            {matchesError && <Callout intent="danger" compact>{matchesError.message}</Callout>}
            <AlertsPanel matches={recentMatches} isReadOnly={isReplaying} />
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
                {isReplaying
                  ? 'No recommendations existed at the replay timestamp.'
                  : 'No active recommendations. System analyses operational state every 30 minutes.'}
              </p>
            ) : (
              topRecs.map(rec => (
                <RecommendationCard
                  key={rec.id}
                  rec={rec}
                  onViewEvidence={setEvidenceRec}
                  isCommander={isCommander}
                  isReadOnly={isReplaying}
                />
              ))
            )}
          </div>

        {!isReplaying && (
          <>
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
        </>
      </div>

      <EvidenceDrawer rec={evidenceRec} onClose={() => setEvidenceRec(null)} />
      <ExportDialog isOpen={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  )
}
