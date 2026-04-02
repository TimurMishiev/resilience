import { HTMLSelect, Tag, Button, Tooltip } from '@blueprintjs/core'
import { humanize } from '../utils/humanize'
import type { Asset, Posture, Task } from '../api/types'
import { assetStatusIntent } from '../lib/taskIntents'

// Returns the subset of assets selectable under the given posture.
// observe      → nothing selectable (show disabled picker)
// defensive    → available assets only
// weapons_free → all assets
function filterByPosture(assets: Asset[], posture: Posture | undefined): Asset[] {
  if (!posture || posture === 'weapons_free') return assets
  if (posture === 'defensive') return assets.filter(a => a.status === 'available')
  return [] // observe
}

interface AssetPickerProps {
  /** Current asset_id on the entity being edited */
  currentAssetId: string | null
  /** All available assets */
  assets: Asset[]
  /** Pending selection (controlled externally) */
  pendingAsset: string | null | undefined
  /** Called when the user changes the dropdown selection */
  onPendingChange: (assetId: string | null) => void
  /** Called when the user confirms the selection */
  onConfirm: (assetId: string | null) => void
  isPending: boolean
  posture?: Posture
  assignedTasks?: Task[]
  /** Label shown above the picker (default "Asset") */
  label?: string
  /** If true, renders inline without the drawer-specific wrapper */
  minimal?: boolean
  /** If true, disable all user interaction regardless of posture */
  disabled?: boolean
}

export function AssetPicker({
  currentAssetId,
  assets,
  pendingAsset,
  onPendingChange,
  onConfirm,
  isPending,
  posture,
  assignedTasks = [],
  label = 'Asset',
  minimal = false,
  disabled = false,
}: AssetPickerProps) {
  const selectable   = filterByPosture(assets, posture)
  const isRestricted = posture === 'observe'
  const pickedId     = pendingAsset !== undefined ? (pendingAsset ?? '') : (currentAssetId ?? '')
  const pickedAsset  = assets.find(a => a.id === pickedId)

  const hiddenCount = assets.length - selectable.length
  const assignmentSummary = new Map<string, { count: number; siteName: string | null; title: string }>()

  for (const task of assignedTasks) {
    if (!task.asset_id || task.workflow_status === 'resolved') continue
    const existing = assignmentSummary.get(task.asset_id)
    if (existing) {
      existing.count += 1
    } else {
      assignmentSummary.set(task.asset_id, {
        count: 1,
        siteName: task.site_name,
        title: task.title,
      })
    }
  }

  const picker = (
    <HTMLSelect
      value={pickedId}
      disabled={disabled || isRestricted || isPending}
      onChange={e => onPendingChange(e.currentTarget.value || null)}
      options={[
        { label: '— Unassigned —', value: '' },
        ...selectable.map(a => {
          const summary = assignmentSummary.get(a.id)
          const assignmentLabel = summary
            ? summary.count > 1
              ? ` · conflict (${summary.count} tasks)`
              : ` · assigned to ${summary.title}${summary.siteName ? ` @ ${summary.siteName}` : ''}`
            : ''
          return { label: `${a.name} · ${humanize(a.status)}${assignmentLabel}`, value: a.id }
        }),
      ]}
      style={minimal ? { fontSize: 12, height: 24 } : undefined}
    />
  )

  if (minimal) {
    // Compact inline variant used in table cells (IncidentDetailPage TasksTab)
    return isRestricted ? (
      <Tooltip content="Assignment restricted: Observe posture" compact>
        <span style={{ opacity: 0.45, pointerEvents: 'none' }}>
          {picker}
        </span>
      </Tooltip>
    ) : picker
  }

  // Drawer variant (TasksPage)
  return (
    <div className="drawer-asset-row">
      <span className="drawer-section-label bp6-text-muted">{label}</span>

      {isRestricted ? (
        <Tooltip content="Assignment restricted: Observe posture">
          <span style={{ opacity: 0.45, pointerEvents: 'none' }}>{picker}</span>
        </Tooltip>
      ) : picker}

      {pickedAsset && !isRestricted && (
        <>
          <Tag minimal intent={assetStatusIntent(pickedAsset.status)} style={{ fontSize: 10 }}>
            {humanize(pickedAsset.status)}
          </Tag>
          {assignmentSummary.get(pickedAsset.id)?.count === 1 && (
            <span className="bp6-text-muted" style={{ fontSize: 10 }}>
              assigned to {assignmentSummary.get(pickedAsset.id)?.title}
              {assignmentSummary.get(pickedAsset.id)?.siteName ? ` @ ${assignmentSummary.get(pickedAsset.id)?.siteName}` : ''}
            </span>
          )}
          {(assignmentSummary.get(pickedAsset.id)?.count ?? 0) > 1 && (
            <Tag minimal intent="danger" style={{ fontSize: 10 }}>
              conflict
            </Tag>
          )}
        </>
      )}

      {hiddenCount > 0 && !isRestricted && (
        <span className="bp6-text-muted" style={{ fontSize: 10 }}>
          {hiddenCount} hidden by posture
        </span>
      )}

      {pendingAsset !== undefined && pendingAsset !== currentAssetId && !isRestricted && !disabled && (
        <Button small intent="primary" loading={isPending} onClick={() => onConfirm(pendingAsset)}>
          Assign
        </Button>
      )}
    </div>
  )
}
