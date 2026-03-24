// ---------------------------------------------------------------------------
// EntityCard — unified Palantir-style object view for any first-class entity.
//
// Usage:
//   <EntityCard entityType="task"  entityId={id} />
//   <EntityCard entityType="asset" entityId={id} />
//   <EntityCard entityType="site"  entityId={id} />
//   <EntityCard entityType="ao"    entityId={id} />
//
// Tabs: Overview | Activity | Relations | Raw
// Each entity type renders its own Overview and Relations content.
// Activity (AuditTimeline) and Raw (JSON) are shared.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import {
  Button,
  Callout,
  Spinner,
  Tab,
  Tabs,
  Tag,
  TextArea,
} from '@blueprintjs/core'
import AuditTimeline from './AuditTimeline'
import { AssetPicker } from './AssetPicker'
import { PostureBadge } from './PostureBadge'
import { useRole } from '../hooks/useRole'
import { useReplay } from '../context/ReplayContext'
import { useTask, useTasks, useAllowedTransitions, useTransitionTask, useUpdateTask } from '../hooks/useTasks'
import { useAsset, useAssets, useUpdateAssetStatus } from '../hooks/useAssets'
import { useSite } from '../hooks/useSite'
import { useAreaOfOperation, useAreasOfOperation } from '../hooks/useAreasOfOperation'
import { useSites } from '../hooks/useSites'
import { ASSET_STATUSES } from '../api/types'
import { humanize } from '../utils/humanize'
import type { WorkflowStatus, AssetStatus, Posture } from '../api/types'
import type { Intent } from '@blueprintjs/core'

export type EntityType = 'task' | 'asset' | 'site' | 'ao'

// Maps EntityType to the string expected by AuditTimeline / backend audit log
const AUDIT_ENTITY_TYPE: Record<EntityType, string> = {
  task:  'Task',
  asset: 'Asset',
  site:  'Site',
  ao:    'AreaOfOperation',
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function workflowIntent(status: WorkflowStatus): Intent {
  switch (status) {
    case 'blocked':     return 'danger'
    case 'resolved':    return 'success'
    case 'in_progress': return 'primary'
    case 'triaged':     return 'warning'
    default:            return 'none'
  }
}

function priorityIntent(priority: string): Intent {
  switch (priority) {
    case 'critical': return 'danger'
    case 'high':     return 'warning'
    default:         return 'none'
  }
}

function assetStatusIntent(status: AssetStatus): Intent {
  switch (status) {
    case 'available': return 'success'
    case 'assigned':  return 'primary'
    case 'degraded':  return 'warning'
    case 'offline':   return 'danger'
  }
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function staleness(last_reported_at: string | null, updated_at: string) {
  const ageH = (Date.now() - new Date(last_reported_at ?? updated_at).getTime()) / 3_600_000
  if (ageH < 6)  return null
  if (ageH < 24) return { label: `${Math.round(ageH)}h ago`, intent: 'warning' as Intent }
  return { label: `${Math.round(ageH / 24)}d ago`, intent: 'danger' as Intent }
}

const THREAT_INTENT: Record<string, Intent> = {
  green: 'success', amber: 'warning', red: 'danger', black: 'none',
}

// ---------------------------------------------------------------------------
// Task Overview
// ---------------------------------------------------------------------------

function TaskOverview({ taskId }: { taskId: string }) {
  const { isReplaying } = useReplay()
  const { data: task, isPending } = useTask(taskId)
  const { data: taskRes } = useTasks({ per_page: 200 })
  const { data: transitionsData } = useAllowedTransitions(!isReplaying ? taskId : null)
  const { data: assetRes } = useAssets({ per_page: 200 })
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

      {!isReplaying && allowed.length > 0 && (
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

      {!isReplaying && (
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
        <span className="bp6-text-muted">Created {fmt(task.created_at)}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Asset Overview
// ---------------------------------------------------------------------------

function AssetOverview({ assetId }: { assetId: string }) {
  const { isCommander } = useRole()
  const { isReplaying } = useReplay()
  const { data: asset, isPending } = useAsset(assetId)
  const { data: siteRes } = useSites({ per_page: 200 })
  const updateStatus = useUpdateAssetStatus()

  const [pendingStatus, setPendingStatus] = useState<AssetStatus | null>(null)
  const [updateError,   setUpdateError]   = useState<string | null>(null)

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (!asset)    return null

  const siteMap: Record<string, string> = {}
  for (const s of siteRes?.data ?? []) siteMap[s.id] = s.name

  const stale = staleness(asset.last_reported_at, asset.updated_at)

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
        <span className="bp6-text-muted">Updated {fmt(asset.updated_at)}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Site Overview
// ---------------------------------------------------------------------------

function SiteOverview({ siteId }: { siteId: string }) {
  const { data: site, isPending } = useSite(siteId)

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
        <span className="bp6-text-muted">Updated {fmt(site.updated_at)}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AO Overview
// ---------------------------------------------------------------------------

function AoOverview({ aoId }: { aoId: string }) {
  const { data: ao, isPending } = useAreaOfOperation(aoId)

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
        <span className="bp6-text-muted">Updated {fmt(ao.updated_at)}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Relations tabs
// ---------------------------------------------------------------------------

function TaskRelations({ taskId }: { taskId: string }) {
  const { data: task, isPending } = useTask(taskId)
  const { data: assetRes }        = useAssets({ per_page: 200 })

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

function AssetRelations({ assetId }: { assetId: string }) {
  const { data: asset, isPending } = useAsset(assetId)
  const { data: siteRes }          = useSites({ per_page: 200 })

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

function SiteRelations({ siteId }: { siteId: string }) {
  const { data: site, isPending } = useSite(siteId)
  const { data: aoRes }           = useAreasOfOperation({ per_page: 200 })

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

function AoRelations({ aoId }: { aoId: string }) {
  const { data: siteRes, isPending } = useSites({ per_page: 200 })

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

// ---------------------------------------------------------------------------
// Raw tab — entity JSON dump; only renders when the tab is active
// ---------------------------------------------------------------------------

function RawPanel({ entityType, entityId }: { entityType: EntityType; entityId: string }) {
  const taskQuery  = useTask(entityType === 'task'  ? entityId : undefined)
  const assetQuery = useAsset(entityType === 'asset' ? entityId : undefined)
  const siteQuery  = useSite(entityType === 'site'  ? entityId : undefined)
  const aoQuery    = useAreaOfOperation(entityType === 'ao' ? entityId : undefined)

  const data = entityType === 'task'  ? taskQuery.data
             : entityType === 'asset' ? assetQuery.data
             : entityType === 'site'  ? siteQuery.data
             : aoQuery.data

  if (!data) return <Spinner size={20} style={{ marginTop: 24 }} />

  return <pre className="entity-raw">{JSON.stringify(data, null, 2)}</pre>
}

// ---------------------------------------------------------------------------
// EntityCard — public export
// ---------------------------------------------------------------------------

export interface EntityCardProps {
  entityType: EntityType
  entityId:   string
}

export default function EntityCard({ entityType, entityId }: EntityCardProps) {
  const auditType = AUDIT_ENTITY_TYPE[entityType]

  function overviewPanel() {
    switch (entityType) {
      case 'task':  return <TaskOverview  key={entityId} taskId={entityId}  />
      case 'asset': return <AssetOverview key={entityId} assetId={entityId} />
      case 'site':  return <SiteOverview  key={entityId} siteId={entityId}  />
      case 'ao':    return <AoOverview    key={entityId} aoId={entityId}    />
    }
  }

  function relationsPanel() {
    switch (entityType) {
      case 'task':  return <TaskRelations  key={entityId} taskId={entityId}  />
      case 'asset': return <AssetRelations key={entityId} assetId={entityId} />
      case 'site':  return <SiteRelations  key={entityId} siteId={entityId}  />
      case 'ao':    return <AoRelations    key={entityId} aoId={entityId}    />
    }
  }

  return (
    <div className="entity-card">
      <Tabs id={`entity-card-${entityId}`} renderActiveTabPanelOnly>
        <Tab
          id="overview"
          title="Overview"
          panel={<div className="entity-tab-panel">{overviewPanel()}</div>}
        />
        <Tab
          id="activity"
          title="Activity"
          panel={
            <div className="entity-tab-panel">
              <AuditTimeline entityType={auditType} entityId={entityId} />
            </div>
          }
        />
        <Tab
          id="relations"
          title="Relations"
          panel={<div className="entity-tab-panel">{relationsPanel()}</div>}
        />
        <Tab
          id="raw"
          title="Raw"
          panel={
            <div className="entity-tab-panel">
              <RawPanel entityType={entityType} entityId={entityId} />
            </div>
          }
        />
      </Tabs>
    </div>
  )
}
