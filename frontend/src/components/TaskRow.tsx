import { useState } from 'react'
import { Button, InputGroup, Tag } from '@blueprintjs/core'
import { useTransitionTask } from '../hooks/useTasks'
import type { Task, WorkflowStatus } from '../api/types'
import type { UserRole } from '../hooks/useRole'
import { humanize } from '../utils/humanize'
import { workflowIntent, priorityIntent, transitionIntent } from '../lib/taskIntents'

const ALLOWED_TASK_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  new:         ['triaged'],
  triaged:     ['in_progress'],
  in_progress: ['blocked', 'resolved'],
  blocked:     ['in_progress'],
  resolved:    ['triaged'],
}

const COMMANDER_ONLY_TASK_TRANSITIONS: Partial<Record<WorkflowStatus, WorkflowStatus[]>> = {
  in_progress: ['resolved'],
  blocked:     ['in_progress'],
  resolved:    ['triaged'],
}

function allowedTaskTransitions(status: WorkflowStatus, role: UserRole): WorkflowStatus[] {
  const next = ALLOWED_TASK_TRANSITIONS[status] ?? []
  if (role === 'commander') return next

  const commanderOnly = COMMANDER_ONLY_TASK_TRANSITIONS[status] ?? []
  return next.filter(candidate => !commanderOnly.includes(candidate))
}

function transitionLabel(s: WorkflowStatus): string {
  return humanize(s)
}

interface TaskRowProps {
  task: Task
  disabled: boolean
  role: UserRole
  onTransitioned: () => void
}

export function TaskRow({ task, disabled, role, onTransitioned }: TaskRowProps) {
  const transition = useTransitionTask()
  const [blockReason, setBlockReason] = useState('')
  const [blocking, setBlocking]       = useState(false)
  const next = allowedTaskTransitions(task.workflow_status, role)

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
          <Tag minimal intent={workflowIntent(task.workflow_status)}>
            {humanize(task.workflow_status)}
          </Tag>
          <Tag minimal intent={priorityIntent(task.priority)}>
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
