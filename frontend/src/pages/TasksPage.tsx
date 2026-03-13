import { useEffect, useState } from 'react'
import {
  Callout,
  HTMLSelect,
  HTMLTable,
  NonIdealState,
  Spinner,
  Tag,
} from '@blueprintjs/core'
import { getTasks } from '../api/tasks'
import { getSites } from '../api/sites'
import type { Task, Site, WorkflowStatus } from '../api/types'
import type { Intent } from '@blueprintjs/core'

const WORKFLOW_STATUS_OPTIONS: { label: string; value: WorkflowStatus | '' }[] = [
  { label: 'All statuses', value: '' },
  { label: 'New', value: 'new' },
  { label: 'Triaged', value: 'triaged' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Blocked', value: 'blocked' },
  { label: 'Resolved', value: 'resolved' },
]

function workflowIntent(status: WorkflowStatus): Intent {
  switch (status) {
    case 'blocked':   return 'danger'
    case 'resolved':  return 'success'
    case 'in_progress': return 'primary'
    case 'triaged':   return 'warning'
    default:          return 'none'
  }
}

function priorityIntent(priority: Task['priority']): Intent {
  switch (priority) {
    case 'critical': return 'danger'
    case 'high':     return 'warning'
    default:         return 'none'
  }
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [siteMap, setSiteMap] = useState<Record<string, string>>({})
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setError(null)

    const params = {
      per_page: 100,
      ...(statusFilter ? { workflow_status: statusFilter } : {}),
    }

    Promise.all([getTasks(params), getSites({ per_page: 200 })])
      .then(([taskRes, siteRes]) => {
        setTasks(taskRes.data)
        setTotal(taskRes.meta.total)
        const map: Record<string, string> = {}
        for (const site of siteRes.data) {
          map[site.id] = site.name
        }
        setSiteMap(map)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Unknown error'))
      .finally(() => setLoading(false))
  }, [statusFilter])

  if (loading) {
    return (
      <div className="page-center">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-content">
        <Callout intent="danger" title="Failed to load tasks">
          {error}
        </Callout>
      </div>
    )
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h2 className="bp6-heading">Tasks</h2>
        <span className="bp6-text-muted">{total} total</span>
        <HTMLSelect
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.currentTarget.value as WorkflowStatus | '')}
          options={WORKFLOW_STATUS_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
        />
      </div>

      {tasks.length === 0 ? (
        <NonIdealState
          icon="th-list"
          title="No tasks"
          description={statusFilter ? `No tasks with status "${statusFilter}".` : 'No tasks found.'}
        />
      ) : (
        <HTMLTable className="data-table" striped interactive>
          <thead>
            <tr>
              <th>Title</th>
              <th>Site</th>
              <th>Priority</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>{task.title}</td>
                <td className="bp6-text-muted">{siteMap[task.site_id] ?? task.site_id}</td>
                <td>
                  <Tag minimal intent={priorityIntent(task.priority)}>
                    {task.priority}
                  </Tag>
                </td>
                <td>
                  <Tag minimal intent={workflowIntent(task.workflow_status)}>
                    {task.workflow_status.replace('_', ' ')}
                  </Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      )}
    </div>
  )
}
