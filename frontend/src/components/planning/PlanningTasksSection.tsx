import { HTMLTable, NonIdealState, Tag } from '@blueprintjs/core'
import { PostureBadge } from '../PostureBadge'
import { AssetPicker } from '../AssetPicker'
import { humanize } from '../../utils/humanize'
import { PRIORITY_INTENT } from '../../lib/planningPageUtils'
import type { Asset, Posture, Task } from '../../api/types'

interface PlanningTasksSectionProps {
  tasks: Task[]
  assets: Asset[]
  pendingAssets: Record<string, string | null | undefined>
  updateTaskPending: boolean
  updateTaskId?: string
  isReplaying: boolean
  onOpenTask: (taskId: string) => void
  onPendingChange: (taskId: string, assetId: string | null) => void
  onConfirm: (taskId: string, assetId: string | null) => void
}

export function PlanningTasksSection({
  tasks,
  assets,
  pendingAssets,
  updateTaskPending,
  updateTaskId,
  isReplaying,
  onOpenTask,
  onPendingChange,
  onConfirm,
}: PlanningTasksSectionProps) {
  return (
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
            {tasks.map(task => {
              const pending = pendingAssets[task.id]
              const isMutating = updateTaskPending && updateTaskId === task.id

              return (
                <tr key={task.id}>
                  <td>
                    <span
                      style={{ cursor: 'pointer', fontWeight: 500 }}
                      onClick={() => onOpenTask(task.id)}
                      title={task.description ?? undefined}
                    >
                      {task.title}
                    </span>
                  </td>
                  <td className="bp6-text-muted" style={{ fontSize: 12 }}>
                    {task.site_name ?? '—'}
                  </td>
                  <td>
                    {task.ao_posture ? (
                      <PostureBadge posture={task.ao_posture as Posture} />
                    ) : (
                      <span className="bp6-text-muted" style={{ fontSize: 11 }}>No AO</span>
                    )}
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
                      onPendingChange={assetId => onPendingChange(task.id, assetId)}
                      onConfirm={assetId => onConfirm(task.id, assetId)}
                      isPending={isMutating}
                      posture={task.ao_posture as Posture | undefined ?? undefined}
                    />
                    {pending !== undefined && pending !== task.asset_id && !isMutating && !isReplaying && (
                      <button
                        className="bp6-button bp6-small bp6-intent-primary"
                        style={{ marginLeft: 6 }}
                        onClick={() => onConfirm(task.id, pending)}
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
  )
}
