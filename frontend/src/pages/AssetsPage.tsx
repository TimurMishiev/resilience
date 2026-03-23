import { useState } from 'react'
import {
  Button,
  Callout,
  Classes,
  Divider,
  Drawer,
  DrawerSize,
  HTMLTable,
  NonIdealState,
  Tag,
} from '@blueprintjs/core'
import { useAssets, useUpdateAssetStatus } from '../hooks/useAssets'
import { useSites } from '../hooks/useSites'
import { useReplay } from '../context/ReplayContext'
import { useRole } from '../hooks/useRole'
import AuditTimeline from '../components/AuditTimeline'
import { ASSET_STATUSES } from '../api/types'
import type { Asset, AssetStatus } from '../api/types'
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

/** Returns a human-readable staleness string, or null if fresh (< 6 h) */
function stalenessLabel(updatedAt: string): { label: string; intent: Intent } | null {
  const ageMs  = Date.now() - new Date(updatedAt).getTime()
  const ageH   = ageMs / 3_600_000
  if (ageH < 6)  return null
  if (ageH < 24) return { label: `${Math.round(ageH)}h ago`, intent: 'warning' }
  const ageD = Math.round(ageH / 24)
  return { label: `${ageD}d ago`, intent: 'danger' }
}

const SKELETON_ROWS = 7

export default function AssetsPage() {
  const { asOf, isReplaying } = useReplay()
  const { isCommander } = useRole()
  const params = { per_page: 100, ...(asOf ? { as_of: asOf } : {}) }

  const { data: assetRes, error: assetError, isPending: assetsPending } = useAssets(params)
  const { data: siteRes,  isPending: sitesPending } = useSites(params)
  const updateStatus = useUpdateAssetStatus()

  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [pendingStatus, setPendingStatus] = useState<AssetStatus | null>(null)
  const [updateError, setUpdateError]     = useState<string | null>(null)

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

  function openDrawer(asset: Asset) {
    setSelectedAsset(asset)
    setPendingStatus(null)
    setUpdateError(null)
  }

  function closeDrawer() {
    setSelectedAsset(null)
    setPendingStatus(null)
    setUpdateError(null)
  }

  async function handleStatusChange() {
    if (!selectedAsset || !pendingStatus) return
    const assetId = selectedAsset.id
    setUpdateError(null)
    try {
      const updated = await updateStatus.mutateAsync({ id: assetId, status: pendingStatus })
      // Only update drawer if it's still showing the same asset
      setSelectedAsset(prev => prev?.id === assetId ? updated : prev)
      setPendingStatus(null)
    } catch (err: unknown) {
      setUpdateError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  if (!loading && assets.length === 0) {
    return (
      <NonIdealState icon="cube" title="No assets" description="No assets found." />
    )
  }

  const stale = selectedAsset ? stalenessLabel(selectedAsset.updated_at) : null

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
                  const staleInfo = stalenessLabel(asset.updated_at)
                  return (
                    <tr key={asset.id} onClick={() => openDrawer(asset)} className="clickable-row">
                      <td>{asset.name}</td>
                      <td>
                        <Tag minimal>{typeLabel(asset.asset_type)}</Tag>
                      </td>
                      <td>
                        <Tag minimal intent={statusIntent(asset.status)}>
                          {statusLabel(asset.status)}
                        </Tag>
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
        onClose={closeDrawer}
        size={DrawerSize.SMALL}
        title={selectedAsset?.name ?? ''}
        className="bp6-dark"
      >
        {selectedAsset && (
          <div className="drawer-body">
            <div className="drawer-tags">
              <Tag minimal intent={statusIntent(selectedAsset.status)}>
                {statusLabel(selectedAsset.status)}
              </Tag>
              <Tag minimal>{typeLabel(selectedAsset.asset_type)}</Tag>
              {selectedAsset.home_site_id && (
                <Tag minimal>{siteMap[selectedAsset.home_site_id] ?? selectedAsset.home_site_id}</Tag>
              )}
              {stale && (
                <Tag minimal intent={stale.intent} icon="time">
                  Updated {stale.label}
                </Tag>
              )}
            </div>

            {/* Status management — commander only, hidden in replay */}
            {isCommander && !isReplaying && (
              <div className="drawer-transitions" style={{ marginTop: 16 }}>
                <span className="drawer-section-label bp6-text-muted">Change status</span>
                <div className="transition-buttons">
                  {ASSET_STATUSES.filter(s => s !== selectedAsset.status).map(s => (
                    <Button
                      key={s}
                      small
                      active={pendingStatus === s}
                      intent={statusIntent(s)}
                      onClick={() => {
                        setPendingStatus(pendingStatus === s ? null : s)
                        setUpdateError(null)
                      }}
                    >
                      {statusLabel(s)}
                    </Button>
                  ))}
                </div>

                {pendingStatus && (
                  <Button
                    intent="primary"
                    small
                    fill
                    loading={updateStatus.isPending}
                    onClick={handleStatusChange}
                    className="transition-confirm"
                  >
                    Confirm — set to {statusLabel(pendingStatus)}
                  </Button>
                )}

                {updateError && (
                  <Callout intent="danger" compact>{updateError}</Callout>
                )}
              </div>
            )}

            <Divider />

            <h4 className="bp6-heading drawer-section-title">Audit History</h4>
            <AuditTimeline entityType="Asset" entityId={selectedAsset.id} />
          </div>
        )}
      </Drawer>
    </>
  )
}
