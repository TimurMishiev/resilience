import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Callout,
  Divider,
  Drawer,
  DrawerSize,
  HTMLSelect,
  HTMLTable,
  InputGroup,
  NonIdealState,
  Spinner,
  Tag,
} from '@blueprintjs/core'
import { getTasks } from '../api/tasks'
import { getSites } from '../api/sites'
import { getAiFilter } from '../api/ai'
import AuditTimeline from '../components/AuditTimeline'
import { useReplay } from '../context/ReplayContext'
import type { Task, TaskPriority, WorkflowStatus } from '../api/types'
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
    case 'blocked':     return 'danger'
    case 'resolved':    return 'success'
    case 'in_progress': return 'primary'
    case 'triaged':     return 'warning'
    default:            return 'none'
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
  const { asOf } = useReplay()
  const [tasks, setTasks]               = useState<Task[]>([])
  const [siteMap, setSiteMap]           = useState<Record<string, string>>({})
  const [total, setTotal]               = useState(0)
  const [statusFilter, setStatusFilter]     = useState<WorkflowStatus | ''>('')
  const [siteFilter, setSiteFilter]         = useState<string | null>(null)
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | null>(null)
  const [error, setError]               = useState<string | null>(null)
  const [loading, setLoading]           = useState(true)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  // AI natural-language filter state
  const [nlQuery, setNlQuery]         = useState('')
  const [nlLoading, setNlLoading]     = useState(false)
  const [nlError, setNlError]         = useState<string | null>(null)
  const [nlApplied, setNlApplied]     = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setSelectedTask(null)

    const params = {
      per_page: 100,
      ...(statusFilter   ? { workflow_status: statusFilter } : {}),
      ...(siteFilter     ? { site_id: siteFilter }           : {}),
      ...(priorityFilter ? { priority: priorityFilter }      : {}),
      ...(asOf           ? { as_of: asOf }                   : {}),
    }

    Promise.all([getTasks(params), getSites({ per_page: 200, ...(asOf ? { as_of: asOf } : {}) })])
      .then(([taskRes, siteRes]) => {
        setTasks(taskRes.data)
        setTotal(taskRes.meta?.total ?? taskRes.data.length)
        const map: Record<string, string> = {}
        for (const site of siteRes.data) map[site.id] = site.name
        setSiteMap(map)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Unknown error'))
      .finally(() => setLoading(false))
  }, [statusFilter, siteFilter, priorityFilter, asOf])

  function handleNlSearch() {
    const q = nlQuery.trim()
    if (!q) return

    setNlLoading(true)
    setNlError(null)

    getAiFilter(q)
      .then(({ data }) => {
        const { filters } = data
        setStatusFilter((filters.workflow_status as WorkflowStatus | null) ?? '')
        setSiteFilter(filters.site_id)
        setPriorityFilter(filters.priority as TaskPriority | null)
        setNlApplied(true)
      })
      .catch((err: unknown) => {
        setNlError(err instanceof Error ? err.message : 'AI filter failed')
      })
      .finally(() => setNlLoading(false))
  }

  function clearNlFilter() {
    setNlQuery('')
    setNlApplied(false)
    setNlError(null)
    setStatusFilter('')
    setSiteFilter(null)
    setPriorityFilter(null)
    inputRef.current?.focus()
  }

  if (loading) {
    return <div className="page-center"><Spinner /></div>
  }

  if (error) {
    return (
      <div className="page-content">
        <Callout intent="danger" title="Failed to load tasks">{error}</Callout>
      </div>
    )
  }

  return (
    <>
      <div className="page-content">
        <div className="page-header">
          <h2 className="bp6-heading">Tasks</h2>
          <span className="bp6-text-muted">{total} total</span>
          <HTMLSelect
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.currentTarget.value as WorkflowStatus | '')
              setPriorityFilter(null)
              setNlApplied(false)
            }}
            options={WORKFLOW_STATUS_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
          />
        </div>

        {/* AI natural-language filter */}
        <div className="nl-filter-row">
          <InputGroup
            inputRef={inputRef}
            placeholder="e.g. show blocked tasks at Site Alpha"
            value={nlQuery}
            onChange={(e) => setNlQuery(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleNlSearch() }}
            rightElement={
              nlApplied
                ? <Button minimal icon="cross" onClick={clearNlFilter} title="Clear AI filter" />
                : <Button minimal icon="search" loading={nlLoading} onClick={handleNlSearch} title="Apply AI filter" />
            }
            disabled={nlLoading}
          />
          {nlApplied && (
            <Tag intent="primary" minimal icon="predictive-analysis">
              AI filter applied
            </Tag>
          )}
          {nlError && (
            <span className="nl-filter-error bp6-text-muted">{nlError}</span>
          )}
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
                <tr
                  key={task.id}
                  onClick={() => setSelectedTask(task)}
                  className="clickable-row"
                >
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

      <Drawer
        isOpen={selectedTask !== null}
        onClose={() => setSelectedTask(null)}
        size={DrawerSize.SMALL}
        title={selectedTask?.title ?? ''}
        className="bp6-dark"
      >
        {selectedTask && (
          <div className="drawer-body">
            <div className="drawer-tags">
              <Tag minimal intent={workflowIntent(selectedTask.workflow_status)}>
                {selectedTask.workflow_status.replace('_', ' ')}
              </Tag>
              <Tag minimal intent={priorityIntent(selectedTask.priority)}>
                {selectedTask.priority}
              </Tag>
              <Tag minimal>{siteMap[selectedTask.site_id] ?? selectedTask.site_id}</Tag>
            </div>

            {selectedTask.description && (
              <p className="drawer-description">{selectedTask.description}</p>
            )}

            {selectedTask.blocked_reason && (
              <Callout intent="danger" compact className="drawer-blocked">
                {selectedTask.blocked_reason}
              </Callout>
            )}

            <Divider />

            <h4 className="bp6-heading drawer-section-title">Audit History</h4>
            <AuditTimeline entityType="Task" entityId={selectedTask.id} />
          </div>
        )}
      </Drawer>
    </>
  )
}
