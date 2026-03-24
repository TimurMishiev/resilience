import { useState } from 'react'
import {
  Callout,
  Drawer,
  DrawerSize,
  HTMLTable,
  NonIdealState,
  Spinner,
  Tag,
} from '@blueprintjs/core'
import { usePlanning } from '../hooks/usePlanning'
import { useUpdateTask } from '../hooks/useTasks'
import { useRole } from '../hooks/useRole'
import { useNavigate } from 'react-router-dom'
import { PostureBadge } from '../components/PostureBadge'
import { AssetPicker } from '../components/AssetPicker'
import EntityCard from '../components/EntityCard'
import { humanize } from '../utils/humanize'
import { computeFlags } from '../utils/planningFlags'
import type { Posture, TaskPriority } from '../api/types'
import type { EntityType } from '../components/EntityCard'

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high:     1,
  normal:   2,
  low:      3,
}

const PRIORITY_INTENT: Record<TaskPriority, 'danger' | 'warning' | 'primary' | 'none'> = {
  critical: 'danger',
  high:     'warning',
  normal:   'primary',
  low:      'none',
}

export default function PlanningPage() {
  const { isCommander } = useRole()
  const navigate = useNavigate()
  const { data, isLoading, isError } = usePlanning()
  const updateTask = useUpdateTask()

  // Per-row pending asset selection — keyed by task id
  const [pendingAssets, setPendingAssets] = useState<Record<string, string | null | undefined>>({})
  const [entityCard, setEntityCard] = useState<{ type: EntityType; id: string } | null>(null)

  // All hooks must come before any conditional returns (Rules of Hooks).
  // Destructure with defaults so hooks receive stable empty arrays when data is not yet loaded.
  const {
    tasks          = [],
    assets         = [],
    areas_of_operation = [],
    open_incidents = [],
    meta           = { truncated: false, task_count: 0 },
  } = data ?? {}

  // ── Derived values (dataset is small; no memoization needed) ────────────

  const flags = computeFlags(tasks, assets, open_incidents, areas_of_operation)

  const assetCounts = (() => {
    const counts = { available: 0, assigned: 0, degraded: 0, offline: 0, total: 0 }
    for (const a of assets) {
      counts.total++
      if (a.status in counts) counts[a.status as keyof typeof counts]++
    }
    return counts
  })()

  const aoCoverage = (() => {
    const byAo = new Map<string, { open: number; covered: number }>()
    for (const t of tasks) {
      if (!t.ao_id || t.workflow_status === 'resolved') continue
      const entry = byAo.get(t.ao_id) ?? { open: 0, covered: 0 }
      entry.open++
      if (t.asset_id) entry.covered++
      byAo.set(t.ao_id, entry)
    }
    return byAo
  })()

  const sortedTasks = [...tasks].sort((a, b) => {
    const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    if (pd !== 0) return pd
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })

  // Per-asset allocation map: asset id → open tasks assigned to it
  const assetTaskMap = (() => {
    const m = new Map<string, typeof tasks>()
    for (const t of tasks) {
      if (!t.asset_id || t.workflow_status === 'resolved') continue
      const list = m.get(t.asset_id) ?? []
      list.push(t)
      m.set(t.asset_id, list)
    }
    return m
  })()

  // Only assets that currently have at least one open task, sorted by name
  const allocatedAssets = assets.filter(a => assetTaskMap.has(a.id))

  // ── Early returns (after all hooks) ─────────────────────────────────────
  if (!isCommander) {
    return (
      <NonIdealState
        icon="lock"
        title="Commander access required"
        description="The Operational Planning Surface is only available to commanders."
      />
    )
  }

  if (isLoading) return <NonIdealState icon={<Spinner />} title="Loading planning data…" />
  if (isError || !data) return <NonIdealState icon="error" title="Failed to load planning data" />

  function handlePendingChange(taskId: string, assetId: string | null) {
    setPendingAssets(prev => ({ ...prev, [taskId]: assetId }))
  }

  function handleConfirm(taskId: string, assetId: string | null) {
    updateTask.mutate(
      { id: taskId, body: { asset_id: assetId } },
      { onSuccess: () => setPendingAssets(prev => { const n = { ...prev }; delete n[taskId]; return n }) }
    )
  }

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1400 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 className="bp6-heading" style={{ margin: 0 }}>Operational Planning Surface</h2>
        <span className="bp6-text-muted" style={{ fontSize: 13 }}>
          Cross-site task coverage · asset allocation · ROE posture
        </span>
      </div>

      {/* ── Overcommitment callouts ───────────────────────────────────────── */}
      {flags.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {flags.map((flag, i) => (
            <Callout
              key={i}
              intent={flag.type === 'critical_unassigned' ? 'warning' : 'danger'}
              icon={flag.type === 'double_assigned' ? 'duplicate' : flag.type === 'weapons_free_no_assets' ? 'shield' : 'person'}
              style={{ marginBottom: 8 }}
              compact
            >
              {flag.label}
              {flag.incidentId && (
                <span
                  style={{ marginLeft: 12, cursor: 'pointer', textDecoration: 'underline', fontSize: 12 }}
                  onClick={() => navigate(`/incidents/${flag.incidentId}`)}
                >
                  View incident →
                </span>
              )}
            </Callout>
          ))}
        </div>
      )}

      {meta.truncated && (
        <Callout intent="warning" icon="warning-sign" compact style={{ marginBottom: 16 }}>
          Showing first 500 tasks — some tasks may not be visible.
        </Callout>
      )}

      {/* ── Asset allocation summary ──────────────────────────────────────── */}
      <section style={{ marginBottom: 28 }}>
        <h3 className="bp6-heading" style={{ fontSize: 14, marginBottom: 10, color: 'var(--bp6-text-muted-color)' }}>
          ASSET STATUS
        </h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          {([
            { label: 'Total',      value: assetCounts.total,     intent: 'none'    },
            { label: 'Available',  value: assetCounts.available,  intent: 'success' },
            { label: 'Assigned',   value: assetCounts.assigned,   intent: 'primary' },
            { label: 'Degraded',   value: assetCounts.degraded,   intent: 'warning' },
            { label: 'Offline',    value: assetCounts.offline,    intent: 'danger'  },
          ] as const).map(({ label, value, intent }) => (
            <div key={label} style={{ textAlign: 'center', minWidth: 72 }}>
              <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{value}</div>
              <Tag minimal intent={intent === 'none' ? undefined : intent} style={{ fontSize: 11, marginTop: 4 }}>
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
                  const STATUS_INTENT: Record<string, 'success' | 'primary' | 'warning' | 'danger' | undefined> = {
                    available: 'success', assigned: 'primary', degraded: 'warning', offline: 'danger',
                  }
                  return (
                    <tr key={asset.id} style={conflict ? { background: 'rgba(219,55,55,0.08)' } : undefined}>
                      <td style={{ fontWeight: 500 }}>
                        {conflict && (
                          <Tag minimal intent="danger" style={{ marginRight: 6, fontSize: 10 }}>CONFLICT</Tag>
                        )}
                        <span
                          style={{ cursor: 'pointer' }}
                          onClick={() => setEntityCard({ type: 'asset', id: asset.id })}
                        >
                          {asset.name}
                        </span>
                      </td>
                      <td className="bp6-text-muted" style={{ fontSize: 12 }}>{humanize(asset.asset_type)}</td>
                      <td>
                        <Tag minimal intent={STATUS_INTENT[asset.status]} style={{ fontSize: 11 }}>
                          {humanize(asset.status)}
                        </Tag>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {assignedTasks.map((t, i) => (
                          <span key={t.id}>
                            {i > 0 && <span style={{ margin: '0 4px', color: 'var(--bp6-text-muted-color)' }}>·</span>}
                            <Tag minimal intent={PRIORITY_INTENT[t.priority]} style={{ fontSize: 11, marginRight: 2 }}>
                              {humanize(t.priority)}
                            </Tag>
                            {t.title}
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

        {areas_of_operation.length > 0 && (
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
                {areas_of_operation.map(ao => {
                  const cov = aoCoverage.get(ao.id) ?? { open: 0, covered: 0 }
                  const uncovered = cov.open - cov.covered
                  return (
                    <tr key={ao.id}>
                      <td>{ao.name}</td>
                      <td><PostureBadge posture={ao.posture} /></td>
                      <td style={{ textAlign: 'right' }}>{cov.open}</td>
                      <td style={{ textAlign: 'right' }}>
                        <Tag minimal intent={cov.covered > 0 ? 'success' : 'none'} style={{ fontSize: 11 }}>
                          {cov.covered}
                        </Tag>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {uncovered > 0
                          ? <Tag minimal intent="warning" style={{ fontSize: 11 }}>{uncovered}</Tag>
                          : <span className="bp6-text-muted">0</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </HTMLTable>
          </>
        )}
      </section>

      {/* ── Entity card drawer ───────────────────────────────────────────── */}
      <Drawer
        isOpen={entityCard !== null}
        onClose={() => setEntityCard(null)}
        size={DrawerSize.SMALL}
        title={entityCard?.type === 'task' ? 'Task Detail' : 'Asset Detail'}
        hasBackdrop={false}
      >
        {entityCard && (
          <div style={{ padding: 16 }}>
            <EntityCard entityType={entityCard.type} entityId={entityCard.id} />
          </div>
        )}
      </Drawer>

      {/* ── Planning board ────────────────────────────────────────────────── */}
      <section>
        <h3 className="bp6-heading" style={{ fontSize: 14, marginBottom: 10, color: 'var(--bp6-text-muted-color)' }}>
          OPEN TASKS — {tasks.length} total
        </h3>
        {tasks.length === 0 ? (
          <NonIdealState icon="tick-circle" title="No open tasks" description="All tasks are resolved." />
        ) : (
          <HTMLTable compact bordered interactive style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Site</th>
                <th>AO / Posture</th>
                <th>Priority</th>
                <th>Status</th>
                <th style={{ minWidth: 200 }}>Assigned Asset</th>
              </tr>
            </thead>
            <tbody>
              {sortedTasks.map(task => {
                const pending = pendingAssets[task.id]
                const isMutating = updateTask.isPending && updateTask.variables?.id === task.id
                return (
                  <tr key={task.id}>
                    <td>
                      <span
                        style={{ cursor: 'pointer', fontWeight: 500 }}
                        onClick={() => setEntityCard({ type: 'task', id: task.id })}
                        title={task.description ?? undefined}
                      >
                        {task.title}
                      </span>
                    </td>
                    <td className="bp6-text-muted" style={{ fontSize: 12 }}>
                      {task.site_name ?? '—'}
                    </td>
                    <td>
                      {task.ao_posture
                        ? <PostureBadge posture={task.ao_posture as Posture} />
                        : <span className="bp6-text-muted" style={{ fontSize: 11 }}>No AO</span>
                      }
                    </td>
                    <td>
                      <Tag minimal intent={PRIORITY_INTENT[task.priority]} style={{ fontSize: 11 }}>
                        {humanize(task.priority)}
                      </Tag>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {humanize(task.workflow_status)}
                    </td>
                    <td>
                      <AssetPicker
                        minimal
                        currentAssetId={task.asset_id}
                        assets={assets}
                        assignedTasks={tasks}
                        pendingAsset={pending}
                        onPendingChange={assetId => handlePendingChange(task.id, assetId)}
                        onConfirm={assetId => handleConfirm(task.id, assetId)}
                        isPending={isMutating}
                        posture={task.ao_posture as Posture | undefined ?? undefined}
                      />
                      {pending !== undefined && pending !== task.asset_id && !isMutating && (
                        <button
                          className="bp6-button bp6-small bp6-intent-primary"
                          style={{ marginLeft: 6 }}
                          onClick={() => handleConfirm(task.id, pending)}
                        >
                          Assign
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </HTMLTable>
        )}
      </section>
    </div>
  )
}
