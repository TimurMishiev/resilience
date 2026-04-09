import { Classes } from '@blueprintjs/core'
import { COLORS } from '../../lib/colors'
import { scoreIntent, pct } from './utils'

interface DashboardKpiRowProps {
  loading: boolean
  totalTasks: number
  resolvedCount: number
  blockedCount: number
  avgReadiness: number | null
}

export function DashboardKpiRow({
  loading,
  totalTasks,
  resolvedCount,
  blockedCount,
  avgReadiness,
}: DashboardKpiRowProps) {
  return (
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
  )
}
