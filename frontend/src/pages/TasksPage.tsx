import { useRef, useState } from 'react'
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
  TextArea,
} from '@blueprintjs/core'
import { useTasks, useAllowedTransitions, useTransitionTask } from '../hooks/useTasks'
import { useSites } from '../hooks/useSites'
import { getAiFilter } from '../api/ai'
import AuditTimeline from '../components/AuditTimeline'
import { useReplay } from '../context/ReplayContext'
import { useAuth } from '../context/AuthContext'
import type { Task, TaskPriority, WorkflowStatus } from '../api/types'
import type { Intent } from '@blueprintjs/core'

// Transitions that require commander authority:
// - resolving a task (sign-off)
// - unblocking a task (resource / escalation authority)
// - reopening a resolved task
function isCommanderOnlyTransition(task: Task, target: WorkflowStatus): boolean {
  if (target === 'resolved') return true
  if (task.workflow_status === 'blocked'  && target === 'in_progress') return true
  if (task.workflow_status === 'resolved' && target === 'triaged')     return true
  return false
}

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

function statusLabel(status: WorkflowStatus): string {
  switch (status) {
    case 'new':         return 'New'
    case 'triaged':     return 'Triaged'
    case 'in_progress': return 'In Progress'
    case 'blocked':     return 'Blocked'
    case 'resolved':    return 'Resolved'
  }
}

export default function TasksPage() {
  const { asOf, isReplaying } = useReplay()
  const { currentUser } = useAuth()
  const isCommander = currentUser?.role === 'commander'

  const [statusFilter, setStatusFilter]     = useState<WorkflowStatus | ''>('')
  const [siteFilter, setSiteFilter]         = useState<string | null>(null)
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | null>(null)
  const [selectedTask, setSelectedTask]     = useState<Task | null>(null)

  // Transition state
  const [pendingStatus, setPendingStatus]     = useState<WorkflowStatus | null>(null)
  const [blockedReason, setBlockedReason]     = useState('')
  const [transitionError, setTransitionError] = useState<string | null>(null)

  // AI natural-language filter state
  const [nlQuery, setNlQuery]     = useState('')
  const [nlLoading, setNlLoading] = useState(false)
  const [nlError, setNlError]     = useState<string | null>(null)
  const [nlApplied, setNlApplied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const taskParams = {
    per_page: 100,
    ...(statusFilter   ? { workflow_status: statusFilter } : {}),
    ...(siteFilter     ? { site_id: siteFilter }           : {}),
    ...(priorityFilter ? { priority: priorityFilter }      : {}),
    ...(asOf           ? { as_of: asOf }                   : {}),
  }

  const { data: taskRes, error, isPending } = useTasks(taskParams)
  const { data: siteRes } = useSites({ per_page: 200, ...(asOf ? { as_of: asOf } : {}) })
  const { data: transitionsData } = useAllowedTransitions(
    selectedTask && !isReplaying ? selectedTask.id : null
  )
  const transitionMutation = useTransitionTask()

  const tasks = taskRes?.data ?? []
  const total = taskRes?.meta?.total ?? tasks.length

  const siteMap: Record<string, string> = {}
  for (const site of siteRes?.data ?? []) siteMap[site.id] = site.name

  const allowedTransitions = transitionsData?.allowed ?? []

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

  async function handleTransition() {
    if (!selectedTask || !pendingStatus) return
    setTransitionError(null)
    try {
      const updated = await transitionMutation.mutateAsync({
        id: selectedTask.id,
        body: {
          to_status: pendingStatus,
          ...(pendingStatus === 'blocked' ? { blocked_reason: blockedReason.trim() } : {}),
        },
      })
      setSelectedTask(updated)
      setPendingStatus(null)
      setBlockedReason('')
    } catch (err: unknown) {
      setTransitionError(err instanceof Error ? err.message : 'Transition failed')
    }
  }

  if (isPending) {
    return <div className="page-center"><Spinner /></div>
  }

  if (error) {
    return (
      <div className="page-content">
        <Callout intent="danger" title="Failed to load tasks">{error.message}</Callout>
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
            <Tag intent="primary" minimal icon="predictive-analysis">AI filter applied</Tag>
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
                  onClick={() => {
                    setSelectedTask(task)
                    setPendingStatus(null)
                    setBlockedReason('')
                    setTransitionError(null)
                  }}
                  className="clickable-row"
                >
                  <td>{task.title}</td>
                  <td className="bp6-text-muted">{siteMap[task.site_id] ?? task.site_id}</td>
                  <td>
                    <Tag minimal intent={priorityIntent(task.priority)}>{task.priority}</Tag>
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
        onClose={() => {
          setSelectedTask(null)
          setPendingStatus(null)
          setBlockedReason('')
          setTransitionError(null)
        }}
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

            {/* Transitions — hidden in replay mode */}
            {!isReplaying && allowedTransitions.length > 0 && (
              <div className="drawer-transitions">
                <span className="drawer-section-label bp6-text-muted">Move to</span>
                <div className="transition-buttons">
                  {allowedTransitions.map((status) => {
                    const cmdOnly = isCommanderOnlyTransition(selectedTask, status)
                    const blocked = !isCommander && cmdOnly
                    return (
                      <Button
                        key={status}
                        small
                        active={pendingStatus === status}
                        intent={workflowIntent(status)}
                        disabled={blocked}
                        title={blocked ? 'Commander authority required' : undefined}
                        onClick={() => {
                          if (blocked) return
                          setPendingStatus(pendingStatus === status ? null : status)
                          setBlockedReason('')
                          setTransitionError(null)
                        }}
                      >
                        {statusLabel(status)}
                        {cmdOnly && <span className="transition-cmd-badge" title="Commander only"> ★</span>}
                      </Button>
                    )
                  })}
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
                    Confirm — move to {statusLabel(pendingStatus)}
                  </Button>
                )}

                {transitionError && (
                  <Callout intent="danger" compact>{transitionError}</Callout>
                )}
              </div>
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
