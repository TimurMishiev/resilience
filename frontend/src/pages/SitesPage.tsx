import { Callout, Classes, HTMLTable, NonIdealState, Tag, Tooltip } from '@blueprintjs/core'
import { useNavigate } from 'react-router-dom'
import { useSites } from '../hooks/useSites'
import { useRiskScores } from '../hooks/useRiskScores'
import { useReplay } from '../context/ReplayContext'
import type { RiskLevel } from '../api/types'

const SKELETON_ROWS = 7

const RISK_COLOR: Record<RiskLevel, string> = {
  low:      '#23a26d',
  moderate: '#f0b726',
  high:     '#e07b26',
  critical: '#cd4246',
}

export default function SitesPage() {
  const navigate = useNavigate()
  const { asOf } = useReplay()
  const { data, error, isPending } = useSites({ per_page: 100, ...(asOf ? { as_of: asOf } : {}) })
  const { data: riskData } = useRiskScores()

  const riskBySiteId = Object.fromEntries((riskData ?? []).map(r => [String(r.site_id), r]))

  if (error) {
    return (
      <div className="page-content">
        <Callout intent="danger" title="Failed to load sites">
          {error.message}
        </Callout>
      </div>
    )
  }

  if (!isPending && (!data || data.data.length === 0)) {
    return (
      <NonIdealState
        icon="map-marker"
        title="No sites"
        description="No sites have been created yet."
      />
    )
  }

  const sites = data?.data ?? []
  const total = data?.meta?.total ?? sites.length

  return (
    <div className="page-content">
      <div className="page-header">
        <h2 className="bp6-heading">Sites</h2>
        <span className="bp6-text-muted">
          {isPending
            ? <span className={Classes.SKELETON} style={{ width: 48, display: 'inline-block' }}>&nbsp;</span>
            : `${total} total`}
        </span>
      </div>

      <HTMLTable className="data-table" striped interactive>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Risk</th>
            <th>Latitude</th>
            <th>Longitude</th>
          </tr>
        </thead>
        <tbody>
          {isPending
            ? Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <tr key={i}>
                  <td><span className={Classes.SKELETON} style={{ display: 'block' }}>&nbsp;</span></td>
                  <td><span className={Classes.SKELETON} style={{ width: 64, display: 'inline-block' }}>&nbsp;</span></td>
                  <td><span className={Classes.SKELETON} style={{ width: 52, display: 'inline-block' }}>&nbsp;</span></td>
                  <td><span className={Classes.SKELETON} style={{ width: 72, display: 'inline-block' }}>&nbsp;</span></td>
                  <td><span className={Classes.SKELETON} style={{ width: 72, display: 'inline-block' }}>&nbsp;</span></td>
                </tr>
              ))
            : sites.map((site) => {
                const risk = riskBySiteId[String(site.id)]
                return (
                  <tr key={site.id} className="clickable-row" onClick={() => navigate(`/sites/${site.id}`)}>
                    <td>
                      {site.name}
                      {site.flagged_at && (
                        <Tag minimal intent="danger" icon="flag" style={{ marginLeft: 6 }}
                             title={site.flag_reason ?? 'Flagged by correlation engine'}>
                          flagged
                        </Tag>
                      )}
                    </td>
                    <td>
                      <Tag minimal intent={site.status === 'active' ? 'success' : 'none'}>
                        {site.status}
                      </Tag>
                    </td>
                    <td>
                      {risk ? (
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
                              fontSize: 11,
                              color: RISK_COLOR[risk.risk_level],
                              borderColor: RISK_COLOR[risk.risk_level],
                              cursor: 'default',
                              letterSpacing: '0.04em',
                            }}
                          >
                            {risk.risk_level.toUpperCase()} · {risk.score}
                          </Tag>
                        </Tooltip>
                      ) : (
                        <span className="bp6-text-muted">—</span>
                      )}
                    </td>
                    <td className="mono">{Number(site.latitude).toFixed(4)}</td>
                    <td className="mono">{Number(site.longitude).toFixed(4)}</td>
                  </tr>
                )
              })
          }
        </tbody>
      </HTMLTable>
    </div>
  )
}
