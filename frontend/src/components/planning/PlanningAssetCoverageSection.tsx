import { HTMLTable, Tag } from '@blueprintjs/core'
import { PostureBadge } from '../PostureBadge'
import { humanize } from '../../utils/humanize'
import { PRIORITY_INTENT } from '../../lib/planningPageUtils'
import type { Asset, PlanningAoStub, Site, Task } from '../../api/types'
import type { CoverageCircle } from '../../lib/coverage'

interface PlanningAssetCounts {
  available: number
  assigned: number
  degraded: number
  offline: number
  total: number
}

interface SiteCoverageRow {
  site: Site
  area: PlanningAoStub | null
  circles: CoverageCircle[]
  openTaskCount: number
  criticalGap: boolean
}

interface PlanningAssetCoverageSectionProps {
  assetCounts: PlanningAssetCounts
  allocatedAssets: Asset[]
  assetTaskMap: Map<string, Task[]>
  areasOfOperation: PlanningAoStub[]
  aoCoverage: Map<string, { open: number; covered: number }>
  siteCoverageRows: SiteCoverageRow[]
  onOpenAsset: (assetId: string) => void
}

export function PlanningAssetCoverageSection({
  assetCounts,
  allocatedAssets,
  assetTaskMap,
  areasOfOperation,
  aoCoverage,
  siteCoverageRows,
  onOpenAsset,
}: PlanningAssetCoverageSectionProps) {
  const statusCards = [
    { label: 'Total', value: assetCounts.total, intent: undefined },
    { label: 'Available', value: assetCounts.available, intent: 'success' as const },
    { label: 'Assigned', value: assetCounts.assigned, intent: 'primary' as const },
    { label: 'Degraded', value: assetCounts.degraded, intent: 'warning' as const },
    { label: 'Offline', value: assetCounts.offline, intent: 'danger' as const },
  ]
  const statusIntentByAsset: Record<string, 'success' | 'primary' | 'warning' | 'danger' | undefined> = {
    available: 'success',
    assigned: 'primary',
    degraded: 'warning',
    offline: 'danger',
  }

  return (
    <section style={{ marginBottom: 28 }}>
      <h3 className="bp6-heading" style={{ fontSize: 14, marginBottom: 10, color: 'var(--bp6-text-muted-color)' }}>
        ASSET STATUS
      </h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        {statusCards.map(({ label, value, intent }) => (
          <div key={label} style={{ textAlign: 'center', minWidth: 72 }}>
            <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{value}</div>
            <Tag minimal intent={intent} style={{ fontSize: 11, marginTop: 4 }}>
              {label}
            </Tag>
          </div>
        ))}
      </div>

      {allocatedAssets.length > 0 && (
        <>
          <h3 className="bp6-heading" style={{ fontSize: 14, marginBottom: 10, color: 'var(--bp6-text-muted-color)' }}>
            ASSET ALLOCATION
          </h3>
          <HTMLTable compact bordered style={{ width: '100%', maxWidth: 900, marginBottom: 20 }}>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Type</th>
                <th>Status</th>
                <th>Assigned Task(s)</th>
                <th>Site</th>
              </tr>
            </thead>
            <tbody>
              {allocatedAssets.map(asset => {
                const assignedTasks = assetTaskMap.get(asset.id) ?? []
                const conflict = assignedTasks.length > 1

                return (
                  <tr key={asset.id} style={conflict ? { background: 'rgba(219,55,55,0.08)' } : undefined}>
                    <td style={{ fontWeight: 500 }}>
                      {conflict && (
                        <Tag minimal intent="danger" style={{ marginRight: 6, fontSize: 10 }}>CONFLICT</Tag>
                      )}
                      <span style={{ cursor: 'pointer' }} onClick={() => onOpenAsset(asset.id)}>
                        {asset.name}
                      </span>
                    </td>
                    <td className="bp6-text-muted" style={{ fontSize: 12 }}>{humanize(asset.asset_type)}</td>
                    <td>
                      <Tag minimal intent={statusIntentByAsset[asset.status]} style={{ fontSize: 11 }}>
                        {humanize(asset.status)}
                      </Tag>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {assignedTasks.map((task, index) => (
                        <span key={task.id}>
                          {index > 0 && <span style={{ margin: '0 4px', color: 'var(--bp6-text-muted-color)' }}>·</span>}
                          <Tag minimal intent={PRIORITY_INTENT[task.priority]} style={{ fontSize: 11, marginRight: 2 }}>
                            {humanize(task.priority)}
                          </Tag>
                          {task.title}
                        </span>
                      ))}
                    </td>
                    <td className="bp6-text-muted" style={{ fontSize: 12 }}>
                      {assignedTasks[0]?.site_name ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </HTMLTable>
        </>
      )}

      {areasOfOperation.length > 0 && (
        <>
          <h3 className="bp6-heading" style={{ fontSize: 14, marginBottom: 10, color: 'var(--bp6-text-muted-color)' }}>
            AO TASK COVERAGE
          </h3>
          <HTMLTable compact bordered style={{ width: '100%', maxWidth: 700 }}>
            <thead>
              <tr>
                <th>Area of Operation</th>
                <th>Posture</th>
                <th style={{ textAlign: 'right' }}>Open Tasks</th>
                <th style={{ textAlign: 'right' }}>Covered</th>
                <th style={{ textAlign: 'right' }}>Uncovered</th>
              </tr>
            </thead>
            <tbody>
              {areasOfOperation.map(area => {
                const coverage = aoCoverage.get(area.id) ?? { open: 0, covered: 0 }
                const uncovered = coverage.open - coverage.covered

                return (
                  <tr key={area.id}>
                    <td>{area.name}</td>
                    <td><PostureBadge posture={area.posture} /></td>
                    <td style={{ textAlign: 'right' }}>{coverage.open}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Tag minimal intent={coverage.covered > 0 ? 'success' : undefined} style={{ fontSize: 11 }}>
                        {coverage.covered}
                      </Tag>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {uncovered > 0 ? (
                        <Tag minimal intent="warning" style={{ fontSize: 11 }}>{uncovered}</Tag>
                      ) : (
                        <span className="bp6-text-muted">0</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </HTMLTable>
        </>
      )}

      {siteCoverageRows.length > 0 && (
        <>
          <h3 className="bp6-heading" style={{ fontSize: 14, marginBottom: 10, marginTop: 20, color: 'var(--bp6-text-muted-color)' }}>
            LIVE / PROJECTED SITE SENSOR COVERAGE
          </h3>
          <HTMLTable compact bordered style={{ width: '100%', maxWidth: 980 }}>
            <thead>
              <tr>
                <th>Site</th>
                <th>AO / Posture</th>
                <th style={{ textAlign: 'right' }}>Open Tasks</th>
                <th>Coverage</th>
                <th>Projected From</th>
              </tr>
            </thead>
            <tbody>
              {siteCoverageRows.map(({ site, area, circles, openTaskCount, criticalGap }) => (
                <tr key={site.id} style={criticalGap ? { background: 'rgba(219,55,55,0.08)' } : undefined}>
                  <td style={{ fontWeight: 500 }}>{site.name}</td>
                  <td>
                    {area ? <PostureBadge posture={area.posture} /> : <span className="bp6-text-muted" style={{ fontSize: 11 }}>No AO</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{openTaskCount}</td>
                  <td>
                    {circles.length === 0 ? (
                      <Tag minimal intent={criticalGap ? 'danger' : 'warning'} style={{ fontSize: 11 }}>
                        {criticalGap ? 'Uncovered critical gap' : 'Uncovered'}
                      </Tag>
                    ) : (
                      <>
                        <Tag minimal intent="success" style={{ fontSize: 11, marginRight: 6 }}>
                          Covered by {circles.length}
                        </Tag>
                        {circles.some(circle => circle.status === 'degraded') && (
                          <Tag minimal intent="warning" style={{ fontSize: 11 }}>
                            degraded footprint
                          </Tag>
                        )}
                      </>
                    )}
                  </td>
                  <td className="bp6-text-muted" style={{ fontSize: 12 }}>
                    {circles.length === 0
                      ? '—'
                      : circles.slice(0, 3).map(circle => `${circle.assetName} @ ${circle.anchorLabel}`).join(' · ')}
                    {circles.length > 3 && ` · +${circles.length - 3} more`}
                  </td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        </>
      )}
    </section>
  )
}
