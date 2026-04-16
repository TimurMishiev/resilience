import { Callout, Divider, Tag, Tooltip } from '@blueprintjs/core'
import type { Site, Task, RiskLevel, SiteRiskScore } from '../api/types'
import type { UserRole } from '../hooks/useRole'
import { TaskRow } from './TaskRow'
import { MapSiteAlertsSection } from './MapSiteAlertsSection'

const RISK_COLOR: Record<RiskLevel, string> = {
  low:      '#23a26d',
  moderate: '#f0b726',
  high:     '#e07b26',
  critical: '#cd4246',
}

const RISK_LABEL: Record<RiskLevel, string> = {
  low:      'LOW',
  moderate: 'MOD',
  high:     'HIGH',
  critical: 'CRIT',
}

interface MapSitePanelProps {
  site: Site
  tasks: Task[]
  readiness: number | null
  riskBySiteId: Record<string, SiteRiskScore>
  isReplaying: boolean
  role: UserRole
  canTriage: boolean
  referenceTimeMs: number
  onTransitioned: () => void
  onClose: () => void
}

export function MapSitePanel({
  site,
  tasks,
  readiness,
  riskBySiteId,
  isReplaying,
  role,
  canTriage,
  referenceTimeMs,
  onTransitioned,
  onClose,
}: MapSitePanelProps) {
  const risk = riskBySiteId[String(site.id)]

  return (
    <div className="map-panel bp6-dark">
      <div className="map-panel-header">
        <span className="map-panel-title">{site.name}</span>
        <button
          className="map-panel-close bp6-button bp6-minimal bp6-icon-cross"
          onClick={onClose}
          aria-label="Close"
        />
      </div>

      <div className="map-panel-tags">
        <Tag minimal intent={site.status === 'active' ? 'success' : 'none'}>
          {site.status}
        </Tag>
        <Tag minimal>{tasks.length} task{tasks.length !== 1 ? 's' : ''}</Tag>
        {readiness !== null && (
          <Tag
            minimal
            intent={readiness >= 0.8 ? 'success' : readiness >= 0.5 ? 'warning' : 'danger'}
          >
            {Math.round(readiness * 100)}% ready
          </Tag>
        )}
        {risk && (
          <Tooltip
            content={
              <span style={{ fontSize: 11, lineHeight: 1.7 }}>
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
                fontWeight: 700,
                color: RISK_COLOR[risk.risk_level],
                borderColor: RISK_COLOR[risk.risk_level],
                cursor: 'default',
                letterSpacing: '0.04em',
              }}
            >
              RISK {RISK_LABEL[risk.risk_level]} {risk.score}
            </Tag>
          </Tooltip>
        )}
      </div>

      <p className="map-panel-coords bp6-text-muted">
        {Number(site.latitude).toFixed(4)}, {Number(site.longitude).toFixed(4)}
      </p>

      {isReplaying && (
        <Callout intent="warning" compact className="map-replay-notice">
          Replay mode — transitions disabled
        </Callout>
      )}

      {tasks.length > 0 && (
        <>
          <Divider />
          <ul className="map-task-list">
            {tasks.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                disabled={isReplaying}
                role={role}
                onTransitioned={onTransitioned}
              />
            ))}
          </ul>
        </>
      )}

      {tasks.length === 0 && (
        <p className="bp6-text-muted map-no-tasks">No tasks assigned to this site.</p>
      )}

      <Divider />
      <MapSiteAlertsSection
        siteId={site.id}
        referenceTimeMs={referenceTimeMs}
        canTriage={canTriage}
      />
    </div>
  )
}
