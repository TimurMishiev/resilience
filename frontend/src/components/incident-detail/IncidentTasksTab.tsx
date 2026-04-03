import { HTMLTable, NonIdealState, Tag } from '@blueprintjs/core'
import { AssetPicker } from '../AssetPicker'
import { useAssets } from '../../hooks/useAssets'
import { useTasks, useUpdateTask } from '../../hooks/useTasks'
import { humanize } from '../../utils/humanize'
import type { IncidentTask } from '../../api/incidents'
import type { Posture } from '../../api/types'

const TASK_PRIORITY_INTENT: Record<string, 'danger' | 'warning' | 'primary' | 'none'> = {
  critical: 'danger',
  high:     'warning',
  normal:   'primary',
  low:      'none',
}

export default function IncidentTasksTab({
  tasks,
  posture,
  isReadOnly = false,
  asOf,
}: {
  tasks: IncidentTask[]
  posture?: Posture
  isReadOnly?: boolean
  asOf?: string | null
}) {
  const replayParams = asOf ? { as_of: asOf } : {}
  const { data: assetRes } = useAssets({ per_page: 200, ...replayParams })
  const { data: taskRes } = useTasks({ per_page: 200, ...replayParams })
  const updateTask = useUpdateTask()
  const assets = assetRes?.data ?? []
  const allTasks = taskRes?.data ?? []

  if (tasks.length === 0) {
    return (
      <NonIdealState
        icon="clipboard"
        title="No tasks"
        description="No tasks have been generated from the alerts in this incident."
        className="tab-empty-state"
      />
    )
  }
  return (
    <HTMLTable className="data-table" striped>
      <thead>
        <tr>
          <th>Title</th>
          <th>Asset</th>
          <th>Priority</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.id}>
            <td>{t.title}</td>
            <td style={{ minWidth: 160 }}>
              <AssetPicker
                currentAssetId={t.asset_id}
                assets={assets}
                pendingAsset={undefined}
                onPendingChange={(assetId) => {
                  updateTask.mutate({ id: t.id, body: { asset_id: assetId } })
                }}
                onConfirm={(assetId) => {
                  updateTask.mutate({ id: t.id, body: { asset_id: assetId } })
                }}
                isPending={updateTask.isPending}
                posture={posture}
                assignedTasks={allTasks}
                minimal
                disabled={isReadOnly}
              />
            </td>
            <td>
              <Tag minimal intent={TASK_PRIORITY_INTENT[t.priority] ?? 'none'} style={{ fontSize: 10 }}>
                {t.priority}
              </Tag>
            </td>
            <td>
              <Tag minimal style={{ fontSize: 10 }}>
                {humanize(t.workflow_status)}
              </Tag>
            </td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}
