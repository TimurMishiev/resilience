import { useRef, useReducer, useState } from 'react'
import {
  Button,
  Callout,
  Classes,
  Drawer,
  DrawerSize,
  HTMLSelect,
  HTMLTable,
  InputGroup,
  NonIdealState,
  Tag,
} from '@blueprintjs/core'
import { useTasks } from '../hooks/useTasks'
import { useSites } from '../hooks/useSites'
import { useAssets } from '../hooks/useAssets'
import { getAiFilter } from '../api/ai'
import EntityCard from '../components/EntityCard'
import { useReplay } from '../context/ReplayContext'
import { useRole } from '../hooks/useRole'
import { humanize } from '../utils/humanize'
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

// ---------------------------------------------------------------------------
// Filter reducer — manages all filter + AI-search state as a unit so that
// clearing filters is a single dispatch instead of 7 individual setters.
// ---------------------------------------------------------------------------
interface FilterState {
  statusFilter:   WorkflowStatus | ''
  siteFilter:     string | null
  priorityFilter: TaskPriority | null
  dateFrom:       string | null
  dateTo:         string | null
  nlQuery:        string
  nlLoading:      boolean
  nlError:        string | null
  nlApplied:      boolean
}

type FilterAction =
  | { type: 'SET_STATUS';   value: WorkflowStatus | '' }
  | { type: 'SET_SITE';     value: string | null }
  | { type: 'SET_PRIORITY'; value: TaskPriority | null }
  | { type: 'SET_NL_QUERY'; value: string }
  | { type: 'NL_LOADING' }
  | { type: 'NL_SUCCESS'; filters: {
      status:   WorkflowStatus | ''
      site:     string | null
      priority: TaskPriority | null
      dateFrom: string | null
      dateTo:   string | null
    } }
  | { type: 'NL_ERROR'; message: string }
  | { type: 'CLEAR' }

const FILTER_INITIAL: FilterState = {
  statusFilter: '', siteFilter: null, priorityFilter: null,
  dateFrom: null, dateTo: null,
  nlQuery: '', nlLoading: false, nlError: null, nlApplied: false,
}

function filterReducer(state: FilterState, action: FilterAction): FilterState {
  switch (action.type) {
    case 'SET_STATUS':
      return { ...state, statusFilter: action.value }
    case 'SET_SITE':
      return { ...state, siteFilter: action.value }
    case 'SET_PRIORITY':
      return { ...state, priorityFilter: action.value }
    case 'SET_NL_QUERY':
      return { ...state, nlQuery: action.value }
    case 'NL_LOADING':
      return { ...state, nlLoading: true, nlError: null }
    case 'NL_SUCCESS':
      return {
        ...state,
        nlLoading:      false,
        nlApplied:      true,
        statusFilter:   action.filters.status,
        siteFilter:     action.filters.site,
        priorityFilter: action.filters.priority,
        dateFrom:       action.filters.dateFrom,
        dateTo:         action.filters.dateTo,
      }
    case 'NL_ERROR':
      return { ...state, nlLoading: false, nlError: action.message }
    case 'CLEAR':
      return FILTER_INITIAL
  }
}

export default function TasksPage() {
  const { asOf } = useReplay()
  const { isCommander } = useRole()
  const [filters, dispatchFilter] = useReducer(filterReducer, FILTER_INITIAL)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { statusFilter, siteFilter, priorityFilter, dateFrom, dateTo, nlQuery, nlLoading, nlError, nlApplied } = filters

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
  const { data: siteRes }  = useSites({ per_page: 200, ...(asOf ? { as_of: asOf } : {}) })
  const { data: assetRes } = useAssets({ per_page: 200, ...(asOf ? { as_of: asOf } : {}) })

  const tasks = taskRes?.data ?? []
  const total = taskRes?.meta?.total ?? tasks.length

  const siteMap: Record<string, string> = {}
  for (const site of siteRes?.data ?? []) siteMap[site.id] = site.name

  const assetMap: Record<string, string> = {}
  for (const asset of assetRes?.data ?? []) assetMap[asset.id] = asset.name

  function handleNlSearch() {
    const q = nlQuery.trim()
    if (!q) return
    dispatchFilter({ type: 'NL_LOADING' })
    getAiFilter(q)
      .then(({ data }) => {
        const f = data.filters
        dispatchFilter({
          type: 'NL_SUCCESS',
          filters: {
            status:   (f.workflow_status as WorkflowStatus | null) ?? '',
            site:     f.site_id,
            priority: f.priority as TaskPriority | null,
            dateFrom: f.created_after,
            dateTo:   f.created_before,
          },
        })
      })
      .catch((err: unknown) => {
        dispatchFilter({ type: 'NL_ERROR', message: err instanceof Error ? err.message : 'AI filter failed' })
      })
  }

  function clearNlFilter() {
    dispatchFilter({ type: 'CLEAR' })
    inputRef.current?.focus()
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
              dispatchFilter({ type: 'CLEAR' })
              dispatchFilter({ type: 'SET_STATUS', value: e.currentTarget.value as WorkflowStatus | '' })
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
              onChange={(e) => dispatchFilter({ type: 'SET_NL_QUERY', value: e.currentTarget.value })}
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
                      onClick={() => setSelectedTask(task)}
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
                          {humanize(task.workflow_status)}
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
        onClose={() => setSelectedTask(null)}
        size={DrawerSize.SMALL}
        title={selectedTask?.title ?? ''}
        className="bp6-dark"
      >
        {selectedTask && (
          <div className="drawer-body">
            <EntityCard entityType="task" entityId={selectedTask.id} />
          </div>
        )}
      </Drawer>
    </>
  )
}
