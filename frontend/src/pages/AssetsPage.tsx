import { Callout, HTMLTable, NonIdealState, Spinner, Tag } from '@blueprintjs/core'
import { useAssets } from '../hooks/useAssets'
import { useSites } from '../hooks/useSites'
import { useReplay } from '../context/ReplayContext'
import type { AssetStatus } from '../api/types'
import type { Intent } from '@blueprintjs/core'

function statusIntent(status: AssetStatus): Intent {
  switch (status) {
    case 'available':   return 'success'
    case 'in_use':      return 'primary'
    case 'maintenance': return 'warning'
    case 'offline':     return 'danger'
  }
}

function statusLabel(status: AssetStatus): string {
  switch (status) {
    case 'available':   return 'Available'
    case 'in_use':      return 'In use'
    case 'maintenance': return 'Maintenance'
    case 'offline':     return 'Offline'
  }
}

function typeLabel(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export default function AssetsPage() {
  const { asOf } = useReplay()
  const params = { per_page: 100, ...(asOf ? { as_of: asOf } : {}) }

  const { data: assetRes, error: assetError, isPending: assetsPending } = useAssets(params)
  const { data: siteRes,  isPending: sitesPending } = useSites({ per_page: 100, ...params })

  const loading = assetsPending || sitesPending

  if (loading) {
    return <div className="page-center"><Spinner /></div>
  }

  if (assetError) {
    return (
      <div className="page-content">
        <Callout intent="danger" title="Failed to load assets">{assetError.message}</Callout>
      </div>
    )
  }

  const assets = assetRes?.data ?? []
  const total  = assetRes?.meta?.total ?? assets.length

  const siteMap: Record<string, string> = {}
  for (const site of siteRes?.data ?? []) siteMap[site.id] = site.name

  if (assets.length === 0) {
    return (
      <NonIdealState icon="cube" title="No assets" description="No assets found." />
    )
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h2 className="bp6-heading">Assets</h2>
        <span className="bp6-text-muted">{total} total</span>
      </div>

      <HTMLTable className="data-table" striped interactive>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Status</th>
            <th>Home Site</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => (
            <tr key={asset.id}>
              <td>{asset.name}</td>
              <td>
                <Tag minimal>{typeLabel(asset.asset_type)}</Tag>
              </td>
              <td>
                <Tag minimal intent={statusIntent(asset.status)}>
                  {statusLabel(asset.status)}
                </Tag>
              </td>
              <td className="bp6-text-muted">
                {asset.home_site_id ? (siteMap[asset.home_site_id] ?? asset.home_site_id) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </div>
  )
}
