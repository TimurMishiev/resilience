import { useState } from 'react'
import { Button, Callout, Spinner, Tag, TextArea } from '@blueprintjs/core'
import { AssetPicker } from '../AssetPicker'
import { PostureBadge } from '../PostureBadge'
import { useRole } from '../../hooks/useRole'
import { useReferenceTimeMs } from '../../hooks/useReferenceTimeMs'
import { useReplay } from '../../context/ReplayContext'
import { useTask, useTasks, useAllowedTransitions, useTransitionTask, useUpdateTask } from '../../hooks/useTasks'
import { useAsset, useUpdateAssetStatus } from '../../hooks/useAssets'
import { useSite } from '../../hooks/useSite'
import { useAreaOfOperation } from '../../hooks/useAreasOfOperation'
import { useSites } from '../../hooks/useSites'
import { useAssets } from '../../hooks/useAssets'
import { ASSET_STATUSES } from '../../api/types'
import { humanize } from '../../utils/humanize'
import type { WorkflowStatus, AssetStatus } from '../../api/types'
import { workflowIntent, priorityIntent, assetStatusIntent } from '../../lib/taskIntents'
import { fmt, staleness, replayParams, metaLine, THREAT_INTENT } from './internals'

export function TaskOverview({ taskId, asOf }: { taskId: string; asOf?: string | null }) {
  const { isCommander, isOperator } = useRole()
  const { isReplaying } = useReplay()
  const canMutateTask = isCommander || isOperator
  const detailParams = replayParams(asOf)
  const listParams = { per_page: 200, ...(detailParams ?? {}) }
  const { data: task, isPending } = useTask(taskId, detailParams)
  const { data: taskRes } = useTasks(listParams)
  const { data: transitionsData } = useAllowedTransitions(!isReplaying && canMutateTask ? taskId : null)
  const { data: assetRes } = useAssets(listParams)
  const transitionMutation = useTransitionTask()
  const updateMutation     = useUpdateTask()

  const [pendingStatus, setPendingStatus] = useState<WorkflowStatus | null>(null)
  const [blockedReason, setBlockedReason] = useState('')
  const [error,         setError]         = useState<string | null>(null)
  const [pendingAsset,  setPendingAsset]  = useState<string | null | undefined>(undefined)

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (!task)     return null

  const allowed       = transitionsData?.allowed        ?? []
  const commanderOnly = transitionsData?.commander_only ?? []
  const assets        = assetRes?.data ?? []
  const allTasks      = taskRes?.data ?? []
  const posture       = task.ao_posture ?? undefined

  async function handleTransition() {
    if (!pendingStatus) return
    setError(null)
    try {
      await transitionMutation.mutateAsync({
        id:   taskId,
        body: {
          to_status: pendingStatus,
          ...(pendingStatus === 'blocked' ? { blocked_reason: blockedReason.trim() } : {}),
        },
      })
      setPendingStatus(null)
      setBlockedReason('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Transition failed')
    }
  }

  return (
    <div className="entity-overview">
      <div className="drawer-tags">
        <Tag minimal intent={workflowIntent(task.workflow_status)}>
          {humanize(task.workflow_status)}
        </Tag>
        <Tag minimal intent={priorityIntent(task.priority)}>{task.priority}</Tag>
        {task.site_name && <Tag minimal>{task.site_name}</Tag>}
        {posture && <PostureBadge posture={posture} />}
      </div>

      {task.description && (
        <p className="drawer-description">{task.description}</p>
      )}

      {task.blocked_reason && (
        <Callout intent="danger" compact className="drawer-blocked">
          {task.blocked_reason}
        </Callout>
      )}

      {!isReplaying && canMutateTask && allowed.length > 0 && (
        <div className="drawer-transitions">
          <span className="drawer-section-label bp6-text-muted">Move to</span>
          <div className="transition-buttons">
            {allowed.map((status) => (
              <Button
                key={status}
                small
                active={pendingStatus === status}
                intent={workflowIntent(status)}
                onClick={() => {
                  setPendingStatus(pendingStatus === status ? null : status)
                  setError(null)
                }}
              >
                {humanize(status)}
                {commanderOnly.includes(status) && (
                  <span className="transition-cmd-badge" title="Commander only"> ★</span>
                )}
              </Button>
            ))}
          </div>

          {pendingStatus === 'blocked' && (
            <TextArea
              fill
              small
              placeholder="Blocked reason (required)"
              value={blockedReason}
              onChange={(e) => setBlockedReason(e.currentTarget.value)}
              className="transition-blocked-reason"
            />
          )}

          {pendingStatus && (
            <Button
              intent="primary"
              small
              fill
              loading={transitionMutation.isPending}
              disabled={pendingStatus === 'blocked' && !blockedReason.trim()}
              onClick={handleTransition}
              className="transition-confirm"
            >
              Confirm — move to {humanize(pendingStatus)}
            </Button>
          )}

          {error && <Callout intent="danger" compact>{error}</Callout>}
        </div>
      )}

      {!isReplaying && canMutateTask && (
        <AssetPicker
          currentAssetId={task.asset_id}
          assets={assets}
          pendingAsset={pendingAsset}
          onPendingChange={setPendingAsset}
          onConfirm={(assetId) => {
            updateMutation.mutate(
              { id: taskId, body: { asset_id: assetId } },
              { onSuccess: () => setPendingAsset(undefined) },
            )
          }}
          isPending={updateMutation.isPending}
          posture={posture}
          assignedTasks={allTasks}
        />
      )}

      <div className="entity-meta">
        <span className="bp6-text-muted">{metaLine(asOf, `Created ${fmt(task.created_at)}`)}</span>
      </div>
    </div>
  )
}

export function AssetOverview({ assetId, asOf }: { assetId: string; asOf?: string | null }) {
  const { isCommander } = useRole()
  const { isReplaying } = useReplay()
  const detailParams = replayParams(asOf)
  const { data: asset, isPending } = useAsset(assetId, detailParams)
  const { data: siteRes } = useSites({ per_page: 200, ...(detailParams ?? {}) })
  const updateStatus = useUpdateAssetStatus()

  const [pendingStatus, setPendingStatus] = useState<AssetStatus | null>(null)
  const [updateError,   setUpdateError]   = useState<string | null>(null)
  const referenceTimeMs = useReferenceTimeMs(asOf)

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (!asset)    return null

  const siteMap: Record<string, string> = {}
  for (const s of siteRes?.data ?? []) siteMap[s.id] = s.name

  const stale = staleness(
    asset.last_reported_at,
    asset.updated_at,
    referenceTimeMs,
  )

  async function handleStatusChange() {
    if (!pendingStatus) return
    setUpdateError(null)
    try {
      await updateStatus.mutateAsync({ id: assetId, status: pendingStatus })
      setPendingStatus(null)
    } catch (e: unknown) {
      setUpdateError(e instanceof Error ? e.message : 'Update failed')
    }
  }

  return (
    <div className="entity-overview">
      <div className="drawer-tags">
        <Tag minimal intent={assetStatusIntent(asset.status)}>{asset.status}</Tag>
        <Tag minimal>{asset.asset_type}</Tag>
        {asset.home_site_id && (
          <Tag minimal>{siteMap[asset.home_site_id] ?? asset.home_site_id}</Tag>
        )}
        {stale && (
          <Tag minimal intent={stale.intent} icon="time">Updated {stale.label}</Tag>
        )}
      </div>

      {isCommander && !isReplaying && (
        <div className="drawer-transitions" style={{ marginTop: 16 }}>
          <span className="drawer-section-label bp6-text-muted">Change status</span>
          <div className="transition-buttons">
            {ASSET_STATUSES.filter((s) => s !== asset.status).map((s) => (
              <Button
                key={s}
                small
                active={pendingStatus === s}
                intent={assetStatusIntent(s)}
                onClick={() => {
                  setPendingStatus(pendingStatus === s ? null : s)
                  setUpdateError(null)
                }}
              >
                {s}
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
              Confirm — set to {pendingStatus}
            </Button>
          )}

          {updateError && <Callout intent="danger" compact>{updateError}</Callout>}
        </div>
      )}

      <div className="entity-meta">
        <span className="bp6-text-muted">{metaLine(asOf, `Updated ${fmt(asset.updated_at)}`)}</span>
      </div>
    </div>
  )
}

export function SiteOverview({ siteId, asOf }: { siteId: string; asOf?: string | null }) {
  const { data: site, isPending } = useSite(siteId, replayParams(asOf))

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (!site)     return null

  return (
    <div className="entity-overview">
      <div className="drawer-tags">
        <Tag minimal intent={site.status === 'active' ? 'success' : 'none'}>{site.status}</Tag>
        {site.flagged_at && <Tag minimal intent="danger" icon="flag">Flagged</Tag>}
      </div>

      {site.flag_reason && (
        <Callout intent="warning" compact style={{ marginTop: 8 }}>
          {site.flag_reason}
        </Callout>
      )}

      <div className="entity-fields">
        <div className="entity-field">
          <span className="entity-field-label bp6-text-muted">Coordinates</span>
          <span className="entity-field-value">
            {Number(site.latitude).toFixed(4)}, {Number(site.longitude).toFixed(4)}
          </span>
        </div>
        <div className="entity-field">
          <span className="entity-field-label bp6-text-muted">Geofence radius</span>
          <span className="entity-field-value">{site.geofence_radius_km} km</span>
        </div>
      </div>

      <div className="entity-meta">
        <span className="bp6-text-muted">{metaLine(asOf, `Updated ${fmt(site.updated_at)}`)}</span>
      </div>
    </div>
  )
}

export function AoOverview({ aoId, asOf }: { aoId: string; asOf?: string | null }) {
  const { data: ao, isPending } = useAreaOfOperation(aoId, replayParams(asOf))

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (!ao)       return null

  return (
    <div className="entity-overview">
      <div className="drawer-tags">
        <Tag minimal intent={THREAT_INTENT[ao.threat_level] ?? 'none'}>{ao.threat_level}</Tag>
        <PostureBadge posture={ao.posture} />
      </div>

      {ao.description && <p className="drawer-description">{ao.description}</p>}

      <div className="entity-fields">
        {ao.posture_changed_at && (
          <div className="entity-field">
            <span className="entity-field-label bp6-text-muted">Posture since</span>
            <span className="entity-field-value">{fmt(ao.posture_changed_at)}</span>
          </div>
        )}
        <div className="entity-field">
          <span className="entity-field-label bp6-text-muted">Color</span>
          <span className="entity-field-value">
            <span
              style={{
                display: 'inline-block', width: 12, height: 12,
                borderRadius: 2, backgroundColor: ao.color,
                verticalAlign: 'middle', marginRight: 6,
              }}
            />
            {ao.color}
          </span>
        </div>
      </div>

      <div className="entity-meta">
        <span className="bp6-text-muted">{metaLine(asOf, `Updated ${fmt(ao.updated_at)}`)}</span>
      </div>
    </div>
  )
}
