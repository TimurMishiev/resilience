import { useRef, useState } from 'react'
import {
  Button,
  Callout,
  Classes,
  Divider,
  Drawer,
  DrawerSize,
  HTMLSelect,
  HTMLTable,
  InputGroup,
  NonIdealState,
  Tag,
  TextArea,
} from '@blueprintjs/core'
import { useTasks, useAllowedTransitions, useTransitionTask, useUpdateTask } from '../hooks/useTasks'
import { useSites } from '../hooks/useSites'
import { useAssets } from '../hooks/useAssets'
import { getAiFilter } from '../api/ai'
import AuditTimeline from '../components/AuditTimeline'
import { useReplay } from '../context/ReplayContext'
import { useRole } from '../hooks/useRole'
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
  const { isCommander } = useRole()
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
  const [dateFrom, setDateFrom]   = useState<string | null>(null)
  const [dateTo, setDateTo]       = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const taskParams = {
    per_page: 100,
    ...(statusFilter   ? { workflow_status: statusFilter } : {}),
    ...(siteFilter     ? { site_id: siteFilter }           : {}),
    ...(priorityFilter ? { priority: priorityFilter }      : {}),
    ...(dateFrom       ? { created_after:  dateFrom }      : {}),
    ...(dateTo         ? { created_before: dateTo }        : {}),
    ...(asOf           ? { as_of: asOf }                   : {}),
  }

  const { data: taskRes, error, isPending } = useTasks(taskParams)
  const { data: siteRes } = useSites({ per_page: 200, ...(asOf ? { as_of: asOf } : {}) })
  const { data: assetRes } = useAssets({ per_page: 200 })
  const { data: transitionsData } = useAllowedTransitions(
    selectedTask && !isReplaying ? selectedTask.id : null
  )
  const transitionMutation = useTransitionTask()
  const updateMutation = useUpdateTask()
  const [pendingAsset, setPendingAsset] = useState<string | null | undefined>(undefined)

  const tasks = taskRes?.data ?? []
  const total = taskRes?.meta?.total ?? tasks.length

  const siteMap: Record<string, string> = {}
  for (const site of siteRes?.data ?? []) siteMap[site.id] = site.name

  const assetMap: Record<string, string> = {}
  for (const asset of assetRes?.data ?? []) assetMap[asset.id] = asset.name
  const assets = assetRes?.data ?? []

  const allowedTransitions    = transitionsData?.allowed        ?? []
  const commanderOnlyTransitions = transitionsData?.commander_only ?? []

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
        setDateFrom(filters.created_after)
        setDateTo(filters.created_before)
        setNlApplied(true)
      })
      .catch((err: unknown) => {
        setNlError(err instanceof Error ? err.message : 'AI filter failed')
      })
      .finally(() => setNlLoading(false))
  }

  function clearNlConstraints() {
    setNlApplied(false)
    setNlError(null)
    setSiteFilter(null)
    setDateFrom(null)
    setDateTo(null)
  }

  function clearNlFilter() {
    setNlQuery('')
    setNlApplied(false)
    setNlError(null)
    setStatusFilter('')
    setSiteFilter(null)
    setPriorityFilter(null)
    setDateFrom(null)
    setDateTo(null)
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
          <span className="bp6-text-muted">
            {isPending
              ? <span className={Classes.SKELETON} style={{ width: 48, display: 'inline-block' }}>&nbsp;</span>
              : `${total} total`}
          </span>
          <HTMLSelect
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.currentTarget.value as WorkflowStatus | '')
              setPriorityFilter(null)
              clearNlConstraints()
            }}
            options={WORKFLOW_STATUS_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
          />
        </div>

        {/* AI natural-language filter — commander-only (backend enforces same restriction) */}
        {isCommander && (
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
        )}

        {!isPending && tasks.length === 0 ? (
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
                <th>Asset</th>
                <th>Priority</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {isPending
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      <td><span className={Classes.SKELETON} style={{ display: 'block' }}>&nbsp;</span></td>
                      <td><span className={Classes.SKELETON} style={{ width: 96, display: 'inline-block' }}>&nbsp;</span></td>
                      <td><span className={Classes.SKELETON} style={{ width: 80, display: 'inline-block' }}>&nbsp;</span></td>
                      <td><span className={Classes.SKELETON} style={{ width: 64, display: 'inline-block' }}>&nbsp;</span></td>
                      <td><span className={Classes.SKELETON} style={{ width: 72, display: 'inline-block' }}>&nbsp;</span></td>
                    </tr>
                  ))
                : tasks.map((task) => (
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
                      <td className="bp6-text-muted">{task.asset_id ? assetMap[task.asset_id] ?? '—' : '—'}</td>
                      <td>
                        <Tag minimal intent={priorityIntent(task.priority)}>{task.priority}</Tag>
                      </td>
                      <td>
                        <Tag minimal intent={workflowIntent(task.workflow_status)}>
                          {task.workflow_status.replace('_', ' ')}
                        </Tag>
                      </td>
                    </tr>
                  ))
              }
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
          setPendingAsset(undefined)
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
                    const cmdOnly = commanderOnlyTransitions.includes(status)
                    return (
                      <Button
                        key={status}
                        small
                        active={pendingStatus === status}
                        intent={workflowIntent(status)}
                        onClick={() => {
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

            {/* Asset assignment */}
            {!isReplaying && (
              <div className="drawer-asset-row">
                <span className="drawer-section-label bp6-text-muted">Asset</span>
                <HTMLSelect
                  value={pendingAsset !== undefined ? (pendingAsset ?? '') : (selectedTask.asset_id ?? '')}
                  onChange={(e) => setPendingAsset(e.currentTarget.value || null)}
                  options={[
                    { label: '— Unassigned —', value: '' },
                    ...assets.map(a => ({ label: `${a.name} (${a.status})`, value: a.id })),
                  ]}
                />
                {pendingAsset !== undefined && pendingAsset !== selectedTask.asset_id && (
                  <Button
                    small
                    intent="primary"
                    loading={updateMutation.isPending}
                    onClick={() => {
                      updateMutation.mutate(
                        { id: selectedTask.id, body: { asset_id: pendingAsset } },
                        {
                          onSuccess: (updated) => {
                            setSelectedTask(updated)
                            setPendingAsset(undefined)
                          },
                        }
                      )
                    }}
                  >
                    Assign
                  </Button>
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
