import { useState } from 'react'
import {
  Callout,
  Classes,
  Drawer,
  DrawerSize,
  HTMLTable,
  NonIdealState,
  Tag,
} from '@blueprintjs/core'
import { useAssets } from '../hooks/useAssets'
import { useSites } from '../hooks/useSites'
import { useReplay } from '../context/ReplayContext'
import EntityCard from '../components/EntityCard'
import type { Asset, AssetStatus } from '../api/types'
import type { Intent } from '@blueprintjs/core'

function statusIntent(status: AssetStatus): Intent {
  switch (status) {
    case 'available': return 'success'
    case 'assigned':  return 'primary'
    case 'degraded':  return 'warning'
    case 'offline':   return 'danger'
  }
}

function stalenessLabel(
  asset: { last_reported_at: string | null; updated_at: string },
  referenceTimeMs: number,
): { label: string; intent: Intent } | null {
  const ts    = asset.last_reported_at ?? asset.updated_at
  const ageH  = Math.max(0, (referenceTimeMs - new Date(ts).getTime()) / 3_600_000)
  if (ageH < 6)  return null
  if (ageH < 24) return { label: `${Math.round(ageH)}h ago`, intent: 'warning' }
  return { label: `${Math.round(ageH / 24)}d ago`, intent: 'danger' }
}

const SKELETON_ROWS = 7

export default function AssetsPage() {
  const { asOf } = useReplay()
  const params = { per_page: 100, ...(asOf ? { as_of: asOf } : {}) }
  const referenceTimeMs = asOf ? new Date(asOf).getTime() : Date.now()

  const { data: assetRes, error: assetError, isPending: assetsPending } = useAssets(params)
  const { data: siteRes,  isPending: sitesPending } = useSites(params)

  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)

  const loading = assetsPending || sitesPending

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

  if (!loading && assets.length === 0) {
    return (
      <NonIdealState icon="cube" title="No assets" description="No assets found." />
    )
  }

  return (
    <>
      <div className="page-content">
        <div className="page-header">
          <h2 className="bp6-heading">Assets</h2>
          <span className="bp6-text-muted">
            {loading
              ? <span className={Classes.SKELETON} style={{ width: 48, display: 'inline-block' }}>&nbsp;</span>
              : `${total} total`}
          </span>
        </div>

        <HTMLTable className="data-table" striped interactive>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Status</th>
              <th>Last updated</th>
              <th>Home Site</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                  <tr key={i}>
                    <td><span className={Classes.SKELETON} style={{ display: 'block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 80, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 80, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 64, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 96, display: 'inline-block' }}>&nbsp;</span></td>
                  </tr>
                ))
              : assets.map((asset) => {
                  const staleInfo = stalenessLabel(asset, referenceTimeMs)
                  return (
                    <tr key={asset.id} onClick={() => setSelectedAsset(asset)} className="clickable-row">
                      <td>{asset.name}</td>
                      <td>
                        <Tag minimal>{asset.asset_type}</Tag>
                      </td>
                      <td>
                        <Tag minimal intent={statusIntent(asset.status)}>{asset.status}</Tag>
                      </td>
                      <td>
                        {staleInfo
                          ? <Tag minimal intent={staleInfo.intent} style={{ fontSize: 10 }}>{staleInfo.label}</Tag>
                          : <span className="bp6-text-muted" style={{ fontSize: 11 }}>fresh</span>
                        }
                      </td>
                      <td className="bp6-text-muted">
                        {asset.home_site_id ? (siteMap[asset.home_site_id] ?? asset.home_site_id) : '—'}
                      </td>
                    </tr>
                  )
                })
            }
          </tbody>
        </HTMLTable>
      </div>

      <Drawer
        isOpen={selectedAsset !== null}
        onClose={() => setSelectedAsset(null)}
        size={DrawerSize.SMALL}
        title={selectedAsset?.name ?? ''}
        className="bp6-dark"
      >
        {selectedAsset && (
          <div className="drawer-body">
            <EntityCard entityType="asset" entityId={selectedAsset.id} />
          </div>
        )}
      </Drawer>
    </>
  )
}
