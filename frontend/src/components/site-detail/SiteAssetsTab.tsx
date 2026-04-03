import { Callout, HTMLTable, NonIdealState, Spinner, Tag } from '@blueprintjs/core'
import { useAssets } from '../../hooks/useAssets'
import { humanize } from '../../utils/humanize'
import type { Asset } from '../../api/types'

const STATUS_COLOR: Record<string, 'success' | 'warning' | 'danger' | 'none'> = {
  available: 'success', assigned: 'none', degraded: 'warning', offline: 'danger',
}

export default function SiteAssetsTab({ siteId, asOf, onSelect }: { siteId: string; asOf?: string | null; onSelect: (asset: Asset) => void }) {
  const { data, isPending, error } = useAssets({ home_site_id: siteId, per_page: 50, ...(asOf ? { as_of: asOf } : {}) })

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

  return (
    <HTMLTable className="data-table" striped interactive>
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {assets.map((a: Asset) => (
          <tr key={a.id} onClick={() => onSelect(a)} className="clickable-row">
            <td>{a.name}</td>
            <td className="mono">{a.asset_type}</td>
            <td>
              <Tag minimal intent={STATUS_COLOR[a.status] ?? 'none'}>
                {humanize(a.status)}
              </Tag>
            </td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}
