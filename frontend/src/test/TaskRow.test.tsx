import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskRow } from '../components/TaskRow'
import type { Task } from '../api/types'

const useTransitionTask = vi.hoisted(() => vi.fn())

vi.mock('../hooks/useTasks', () => ({
  useTransitionTask: () => useTransitionTask(),
}))

const baseTask: Task = {
  id: 'task-1',
  title: 'Investigate contact',
  description: null,
  priority: 'high',
  workflow_status: 'in_progress',
  blocked_reason: null,
  site_id: 'site-1',
  asset_id: null,
  created_at: '2026-04-09T10:00:00Z',
  updated_at: '2026-04-09T10:05:00Z',
}

describe('TaskRow', () => {
  beforeEach(() => {
    useTransitionTask.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    })
  })

  it('keeps commander-only task transitions available to admins', () => {
    render(<TaskRow task={baseTask} disabled={false} role="admin" onTransitioned={vi.fn()} />)

    expect(screen.getByRole('button', { name: /resolved/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /blocked/i })).toBeInTheDocument()
  })

  it('still hides commander-only task transitions from operators', () => {
    render(<TaskRow task={baseTask} disabled={false} role="operator" onTransitioned={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /resolved/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /blocked/i })).toBeInTheDocument()
  })
})
