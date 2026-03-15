import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Button,
  Callout,
  Divider,
  InputGroup,
  Spinner,
  Tag,
} from '@blueprintjs/core'
import { useQueryClient } from '@tanstack/react-query'
import { useSites } from '../hooks/useSites'
import { useTasks, useTransitionTask } from '../hooks/useTasks'
import { useReplay } from '../context/ReplayContext'
import type { Site, Task, WorkflowStatus } from '../api/types'
import type { Intent } from '@blueprintjs/core'

// ---------------------------------------------------------------------------
// Transition table — mirrors backend ALLOWED_TRANSITIONS
// ---------------------------------------------------------------------------
const ALLOWED: Record<WorkflowStatus, WorkflowStatus[]> = {
  new:         ['triaged'],
  triaged:     ['in_progress'],
  in_progress: ['blocked', 'resolved'],
  blocked:     ['in_progress'],
  resolved:    ['triaged'],
}

function allowedTransitions(status: WorkflowStatus): WorkflowStatus[] {
  return ALLOWED[status] ?? []
}

// ---------------------------------------------------------------------------
// Helpers
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

function priorityIntent(p: Task['priority']): Intent {
  switch (p) {
    case 'critical': return 'danger'
    case 'high':     return 'warning'
    default:         return 'none'
  }
}

function transitionLabel(s: WorkflowStatus): string {
  return s.replace('_', ' ')
}

function transitionIntent(s: WorkflowStatus): Intent {
  switch (s) {
    case 'resolved':    return 'success'
    case 'blocked':     return 'danger'
    case 'in_progress': return 'primary'
    default:            return 'none'
  }
}

function siteHealthClass(tasks: Task[], siteStatus: Site['status']): string {
  if (siteStatus === 'inactive') return 'map-marker--inactive'
  if (tasks.length === 0)        return 'map-marker--active'
  const hasBlocked    = tasks.some(t => t.workflow_status === 'blocked')
  const allResolved   = tasks.every(t => t.workflow_status === 'resolved')
  const hasInProgress = tasks.some(t => t.workflow_status === 'in_progress')
  if (hasBlocked)    return 'map-marker--blocked'
  if (allResolved)   return 'map-marker--resolved'
  if (hasInProgress) return 'map-marker--in-progress'
  return 'map-marker--active'
}

function computeReadiness(tasks: Task[]): number | null {
  const total = tasks.length
  if (total === 0) return null
  const resolved   = tasks.filter(t => t.workflow_status === 'resolved').length
  const nonBlocked = tasks.filter(t => t.workflow_status !== 'blocked').length
  return (resolved / total) * 0.6 + (nonBlocked / total) * 0.4
}

// ---------------------------------------------------------------------------
// TaskRow
// ---------------------------------------------------------------------------
interface TaskRowProps {
  task: Task
  disabled: boolean
  onTransitioned: () => void
}

function TaskRow({ task, disabled, onTransitioned }: TaskRowProps) {
  const transition = useTransitionTask()
  const [blockReason, setBlockReason] = useState('')
  const [blocking, setBlocking]       = useState(false)
  const next = allowedTransitions(task.workflow_status)

  function handleTransition(to: WorkflowStatus) {
    if (to === 'blocked') { setBlocking(true); return }
    transition.mutate(
      { id: task.id, body: { to_status: to } },
      { onSuccess: onTransitioned },
    )
  }

  function submitBlock() {
    transition.mutate(
      { id: task.id, body: { to_status: 'blocked', blocked_reason: blockReason || null } },
      {
        onSuccess: () => {
          setBlocking(false)
          setBlockReason('')
          onTransitioned()
        },
      },
    )
  }

  return (
    <li className="map-task-item">
      <div className="map-task-header">
        <span className="map-task-title">{task.title}</span>
        <div className="map-task-tags">
          <Tag minimal small intent={workflowIntent(task.workflow_status)}>
            {task.workflow_status.replace('_', ' ')}
          </Tag>
          <Tag minimal small intent={priorityIntent(task.priority)}>
            {task.priority}
          </Tag>
        </div>
      </div>

      {task.workflow_status === 'blocked' && task.blocked_reason && (
        <p className="map-task-blocked-reason bp6-text-muted">{task.blocked_reason}</p>
      )}

      {blocking && (
        <div className="map-task-block-input">
          <InputGroup
            small
            placeholder="Reason for blocking (optional)"
            value={blockReason}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBlockReason(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter') submitBlock()
              if (e.key === 'Escape') { setBlocking(false); setBlockReason('') }
            }}
            autoFocus
          />
          <div className="map-task-block-actions">
            <Button small intent="danger" onClick={submitBlock} loading={transition.isPending}>
              Confirm block
            </Button>
            <Button small minimal onClick={() => { setBlocking(false); setBlockReason('') }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!blocking && next.length > 0 && !disabled && (
        <div className="map-task-actions">
          {next.map(to => (
            <Button
              key={to}
              small
              minimal
              intent={transitionIntent(to)}
              onClick={() => handleTransition(to)}
              loading={transition.isPending}
              disabled={transition.isPending}
            >
              → {transitionLabel(to)}
            </Button>
          ))}
        </div>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// MapPage
// ---------------------------------------------------------------------------
export default function MapPage() {
  const { asOf, isReplaying } = useReplay()
  const queryClient           = useQueryClient()

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef          = useRef<maplibregl.Map | null>(null)
  const markersRef      = useRef<maplibregl.Marker[]>([])

  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)

  const asOfParam  = asOf ? { as_of: asOf } : {}
  const sitesQuery = useSites({ per_page: 200, ...asOfParam })
  const tasksQuery = useTasks({ per_page: 200, ...asOfParam })

  const sites    = sitesQuery.data?.data ?? []
  const allTasks = tasksQuery.data?.data ?? []
  const loading  = sitesQuery.isLoading || tasksQuery.isLoading
  const error    = sitesQuery.error?.message ?? tasksQuery.error?.message ?? null

  const tasksBySite: Record<string, Task[]> = {}
  for (const task of allTasks) {
    if (!tasksBySite[task.site_id]) tasksBySite[task.site_id] = []
    tasksBySite[task.site_id].push(task)
  }

  const selectedSite  = sites.find(s => s.id === selectedSiteId) ?? null
  const selectedTasks = selectedSiteId ? (tasksBySite[selectedSiteId] ?? []) : []
  const readiness     = computeReadiness(selectedTasks)

  const handleTransitioned = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    queryClient.invalidateQueries({ queryKey: ['readiness'] })
  }, [queryClient])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return
    mapRef.current = new maplibregl.Map({
      container: mapContainerRef.current,
      style:     'https://demotiles.maplibre.org/style.json',
      center:    [0, 20],
      zoom:      1.5,
    })
    mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-left')
    return () => { mapRef.current?.remove(); mapRef.current = null }
  }, [])

  useEffect(() => { setSelectedSiteId(null) }, [asOf])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const m of markersRef.current) m.remove()
    markersRef.current = []

    for (const site of sites) {
      const tasks  = tasksBySite[site.id] ?? []
      const health = siteHealthClass(tasks, site.status)
      const el     = document.createElement('div')
      el.className = `map-marker ${health}`
      el.title     = site.name

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([Number(site.longitude), Number(site.latitude)])
        .addTo(map)

      el.addEventListener('click', () =>
        setSelectedSiteId(id => id === site.id ? null : site.id)
      )
      markersRef.current.push(marker)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, allTasks])

  return (
    <div className="map-page">
      <div ref={mapContainerRef} className="map-container" />

      {loading && (
        <div className="map-overlay map-overlay--loading"><Spinner /></div>
      )}

      {error && (
        <div className="map-overlay map-overlay--error">
          <Callout intent="danger" title="Failed to load map data" compact>{error}</Callout>
        </div>
      )}

      {selectedSite && (
        <div className="map-panel bp6-dark">
          <div className="map-panel-header">
            <span className="map-panel-title">{selectedSite.name}</span>
            <button
              className="map-panel-close bp6-button bp6-minimal bp6-icon-cross"
              onClick={() => setSelectedSiteId(null)}
              aria-label="Close"
            />
          </div>

          <div className="map-panel-tags">
            <Tag minimal intent={selectedSite.status === 'active' ? 'success' : 'none'}>
              {selectedSite.status}
            </Tag>
            <Tag minimal>{selectedTasks.length} task{selectedTasks.length !== 1 ? 's' : ''}</Tag>
            {readiness !== null && (
              <Tag
                minimal
                intent={readiness >= 0.8 ? 'success' : readiness >= 0.5 ? 'warning' : 'danger'}
              >
                {Math.round(readiness * 100)}% ready
              </Tag>
            )}
          </div>

          <p className="map-panel-coords bp6-text-muted">
            {Number(selectedSite.latitude).toFixed(4)}, {Number(selectedSite.longitude).toFixed(4)}
          </p>

          {isReplaying && (
            <Callout intent="warning" compact className="map-replay-notice">
              Replay mode — transitions disabled
            </Callout>
          )}

          {selectedTasks.length > 0 && (
            <>
              <Divider />
              <ul className="map-task-list">
                {selectedTasks.map(task => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    disabled={isReplaying}
                    onTransitioned={handleTransitioned}
                  />
                ))}
              </ul>
            </>
          )}

          {selectedTasks.length === 0 && (
            <p className="bp6-text-muted map-no-tasks">No tasks assigned to this site.</p>
          )}
        </div>
      )}
    </div>
  )
}
