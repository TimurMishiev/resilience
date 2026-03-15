import { Callout, Classes, Tag } from '@blueprintjs/core'
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from 'recharts'
import { useReadiness, useThroughput } from '../hooks/useReadiness'
import { useTasks } from '../hooks/useTasks'
import { useReplay } from '../context/ReplayContext'
import type { WorkflowStatus, TaskPriority } from '../api/types'

const STATUS_ORDER: WorkflowStatus[] = ['new', 'triaged', 'in_progress', 'blocked', 'resolved']
const PRIORITY_ORDER: TaskPriority[] = ['critical', 'high', 'normal', 'low']

const STATUS_COLOR: Record<WorkflowStatus, string> = {
  new:         '#8a9ba8',
  triaged:     '#f0b726',
  in_progress: '#4580e6',
  blocked:     '#cd4246',
  resolved:    '#23a26d',
}

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  critical: '#cd4246',
  high:     '#f0b726',
  normal:   '#4580e6',
  low:      '#5c7080',
}

function scoreIntent(score: number | null) {
  if (score === null) return '#5c7080'
  if (score >= 0.75) return '#23a26d'
  if (score >= 0.5)  return '#f0b726'
  return '#cd4246'
}

function pct(n: number | null): string {
  if (n === null) return '—'
  return `${Math.round(n * 100)}%`
}

export default function DashboardPage() {
  const { asOf } = useReplay()

  const { data: readinessData, isPending: readinessPending, error: readinessError } = useReadiness(
    asOf ? { as_of: asOf } : undefined
  )
  const { data: taskRes, isPending: tasksPending } = useTasks({
    per_page: 500,
    ...(asOf ? { as_of: asOf } : {}),
  })
  const { data: throughputRes } = useThroughput()

  const tasks       = taskRes?.data ?? []
  const readiness   = readinessData ?? []
  const throughput  = throughputRes?.data ?? []

  // Aggregate task counts
  const statusCounts = STATUS_ORDER.map((s) => ({
    status: s.replace('_', ' '),
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
          <span className="dashboard-kpi-value" style={{ color: '#23a26d' }}>
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
          <span className="dashboard-kpi-value" style={{ color: blockedCount > 0 ? '#cd4246' : '#23a26d' }}>
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
              {readiness.map((s) => (
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
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Task status breakdown */}
        <div className="dashboard-card">
          <h4 className="dashboard-card-title bp6-heading">Tasks by Status</h4>
          {loading ? (
            <div className={Classes.SKELETON} style={{ width: '100%', height: 180 }}>&nbsp;</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={statusCounts} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <XAxis dataKey="status" tick={{ fill: '#8a9ba8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#8a9ba8', fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#252c35', border: '1px solid #383e47', fontSize: 12 }}
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
                <XAxis dataKey="priority" tick={{ fill: '#8a9ba8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#8a9ba8', fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#252c35', border: '1px solid #383e47', fontSize: 12 }}
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

        {/* Throughput — resolved tasks per day */}
        <div className="dashboard-card dashboard-card--wide">
          <h4 className="dashboard-card-title bp6-heading">Resolution Throughput — Last 30 Days</h4>
          {loading ? (
            <div className={Classes.SKELETON} style={{ width: '100%', height: 180 }}>&nbsp;</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={throughput} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2f363f" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#8a9ba8', fontSize: 10 }}
                  tickFormatter={(d: string) => d.slice(5)} // MM-DD
                  interval={4}
                />
                <YAxis tick={{ fill: '#8a9ba8', fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#252c35', border: '1px solid #383e47', fontSize: 12 }}
                  labelFormatter={(d) => String(d)}
                />
                <Line
                  type="monotone"
                  dataKey="resolved"
                  stroke="#23a26d"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#23a26d' }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}
