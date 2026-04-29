import { Spinner, Tag } from '@blueprintjs/core'
import { PostureBadge } from '../PostureBadge'
import { useTask } from '../../hooks/useTasks'
import { useAsset, useAssets } from '../../hooks/useAssets'
import { useSite } from '../../hooks/useSite'
import { useAreasOfOperation } from '../../hooks/useAreasOfOperation'
import { useSites } from '../../hooks/useSites'
import type { Posture } from '../../api/types'
import { fmt, replayParams } from './internals'

export function TaskRelations({ taskId, asOf }: { taskId: string; asOf?: string | null }) {
  const detailParams = replayParams(asOf)
  const { data: task, isPending } = useTask(taskId, detailParams)
  const { data: assetRes }        = useAssets({ per_page: 200, ...(detailParams ?? {}) })

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (!task)     return null

  const assetMap: Record<string, string> = {}
  for (const a of assetRes?.data ?? []) assetMap[a.id] = a.name

  return (
    <div className="entity-relations">
      <div className="relation-row">
        <span className="bp6-text-muted relation-label">Site</span>
        <Tag minimal>{task.site_name ?? task.site_id}</Tag>
      </div>
      <div className="relation-row">
        <span className="bp6-text-muted relation-label">Asset</span>
        <Tag minimal>
          {task.asset_id ? (assetMap[task.asset_id] ?? task.asset_id) : '—'}
        </Tag>
      </div>
      {task.ao_posture && (
        <div className="relation-row">
          <span className="bp6-text-muted relation-label">AO posture</span>
          <PostureBadge posture={task.ao_posture as Posture} />
        </div>
      )}
    </div>
  )
}

export function AssetRelations({ assetId, asOf }: { assetId: string; asOf?: string | null }) {
  const detailParams = replayParams(asOf)
  const { data: asset, isPending } = useAsset(assetId, detailParams)
  const { data: siteRes }          = useSites({ per_page: 200, ...(detailParams ?? {}) })

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (!asset)    return null

  const siteMap: Record<string, string> = {}
  for (const s of siteRes?.data ?? []) siteMap[s.id] = s.name

  return (
    <div className="entity-relations">
      <div className="relation-row">
        <span className="bp6-text-muted relation-label">Home site</span>
        <Tag minimal>
          {asset.home_site_id ? (siteMap[asset.home_site_id] ?? asset.home_site_id) : '—'}
        </Tag>
      </div>
      <div className="relation-row">
        <span className="bp6-text-muted relation-label">Last reported</span>
        <Tag minimal>
          {asset.last_reported_at ? fmt(asset.last_reported_at) : 'Never'}
        </Tag>
      </div>
    </div>
  )
}

export function SiteRelations({ siteId, asOf }: { siteId: string; asOf?: string | null }) {
  const detailParams = replayParams(asOf)
  const { data: site, isPending } = useSite(siteId, detailParams)
  const { data: aoRes }           = useAreasOfOperation({ per_page: 200, ...(detailParams ?? {}) })

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (!site)     return null

  const ao = site.area_of_operation_id
    ? (aoRes?.data ?? []).find((a) => a.id === site.area_of_operation_id)
    : null

  return (
    <div className="entity-relations">
      <div className="relation-row">
        <span className="bp6-text-muted relation-label">Area of Operation</span>
        {ao
          ? <><Tag minimal>{ao.name}</Tag><PostureBadge posture={ao.posture} /></>
          : <Tag minimal>—</Tag>
        }
      </div>
    </div>
  )
}

export function AoRelations({ aoId, asOf }: { aoId: string; asOf?: string | null }) {
  const { data: siteRes, isPending } = useSites({ per_page: 200, ...(replayParams(asOf) ?? {}) })

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />

  const members = (siteRes?.data ?? []).filter((s) => s.area_of_operation_id === aoId)

  return (
    <div className="entity-relations">
      <div className="relation-row">
        <span className="bp6-text-muted relation-label">Member sites</span>
        <div className="relation-tags">
          {members.length === 0
            ? <Tag minimal>—</Tag>
            : members.map((s) => <Tag key={s.id} minimal>{s.name}</Tag>)
          }
        </div>
      </div>
    </div>
  )
}
