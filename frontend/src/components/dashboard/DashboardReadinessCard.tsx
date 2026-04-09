import { Classes, Tag, Tooltip } from '@blueprintjs/core'
import type { RiskLevel, SiteReadiness, SiteRiskScore } from '../../api/types'
import { COLORS } from '../../lib/colors'
import { scoreIntent, pct } from './utils'

const RISK_COLOR: Record<RiskLevel, string> = {
  low: COLORS.success,
  moderate: COLORS.warning,
  high: COLORS.orange,
  critical: COLORS.danger,
}

const RISK_LABEL: Record<RiskLevel, string> = {
  low: 'LOW',
  moderate: 'MOD',
  high: 'HIGH',
  critical: 'CRIT',
}

interface DashboardReadinessCardProps {
  loading: boolean
  readiness: SiteReadiness[]
  riskBySite: Record<string, SiteRiskScore>
}

export function DashboardReadinessCard({
  loading,
  readiness,
  riskBySite,
}: DashboardReadinessCardProps) {
  return (
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
          {readiness.map((siteReadiness) => {
            const risk = riskBySite[siteReadiness.site_id]
            return (
              <div key={siteReadiness.site_id} className="readiness-row">
                <span className="readiness-name">{siteReadiness.site_name}</span>
                <div className="readiness-bar-track">
                  <div
                    className="readiness-bar-fill"
                    style={{
                      width: `${Math.round((siteReadiness.score ?? 0) * 100)}%`,
                      backgroundColor: scoreIntent(siteReadiness.score),
                    }}
                  />
                </div>
                <span className="readiness-pct" style={{ color: scoreIntent(siteReadiness.score) }}>
                  {pct(siteReadiness.score)}
                </span>
                <div className="readiness-counts">
                  <Tag minimal intent="success" style={{ fontSize: 10 }}>{siteReadiness.counts.resolved}R</Tag>
                  {siteReadiness.counts.blocked > 0 && (
                    <Tag minimal intent="danger" style={{ fontSize: 10 }}>{siteReadiness.counts.blocked}B</Tag>
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
  )
}
