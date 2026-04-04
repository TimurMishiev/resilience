import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  isCommander: true,
  tasks: {
    data: {
      data: [
        { id: 't1', title: 'Inspect pier', site_id: 's1', asset_id: null, priority: 'high', workflow_status: 'in_progress', description: null, blocked_reason: null },
        { id: 't2', title: 'Repair radar', site_id: 's1', asset_id: 'a1', priority: 'critical', workflow_status: 'blocked', description: null, blocked_reason: 'Parts missing' },
      ],
      meta: { total: 2 },
    },
    error: null as Error | null,
    isPending: false,
  },
}))

vi.mock('../hooks/useTasks', () => ({
  useTasks: () => mockState.tasks,
}))
vi.mock('../hooks/useSites', () => ({
  useSites: () => ({ data: { data: [{ id: 's1', name: 'Alpha Base' }] } }),
}))
vi.mock('../hooks/useAssets', () => ({
  useAssets: () => ({ data: { data: [{ id: 'a1', name: 'Drone Alpha' }] } }),
}))
vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({ asOf: null, isReplaying: false }),
}))
vi.mock('../hooks/useRole', () => ({
  useRole: () => ({ isCommander: mockState.isCommander }),
}))
vi.mock('../api/ai', () => ({
  getAiFilter: vi.fn(),
}))
vi.mock('../components/EntityCard', () => ({
  default: () => <div>EntityCard</div>,
}))

import TasksPage from '../pages/TasksPage'

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('TasksPage', () => {
  beforeEach(() => {
    mockState.isCommander = true
    mockState.tasks.error = null
    mockState.tasks.isPending = false
  })

  it('renders task table with data', () => {
    renderPage()

    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.getByText('2 total')).toBeInTheDocument()
    expect(screen.getByText('Inspect pier')).toBeInTheDocument()
    expect(screen.getByText('Repair radar')).toBeInTheDocument()
    expect(screen.getAllByText('Alpha Base')).toHaveLength(2)
    expect(screen.getByText('Drone Alpha')).toBeInTheDocument()
  })

  it('shows error callout on fetch failure', () => {
    mockState.tasks.error = new Error('Server error')

    renderPage()

    expect(screen.getByText('Failed to load tasks')).toBeInTheDocument()
    expect(screen.getByText('Server error')).toBeInTheDocument()
  })

  it('shows NL filter for commanders but not operators', () => {
    renderPage()
    expect(screen.getByPlaceholderText(/show blocked tasks/i)).toBeInTheDocument()

    mockState.isCommander = false
    renderPage()
    expect(screen.queryAllByPlaceholderText(/show blocked tasks/i)).toHaveLength(1) // only from first render
  })

  it('shows empty state when no tasks', () => {
    mockState.tasks.data = { data: [], meta: { total: 0 } }
    mockState.tasks.isPending = false

    renderPage()

    expect(screen.getByText('No tasks')).toBeInTheDocument()

    // Restore
    mockState.tasks.data = {
      data: [
        { id: 't1', title: 'Inspect pier', site_id: 's1', asset_id: null, priority: 'high', workflow_status: 'in_progress', description: null, blocked_reason: null },
        { id: 't2', title: 'Repair radar', site_id: 's1', asset_id: 'a1', priority: 'critical', workflow_status: 'blocked', description: null, blocked_reason: 'Parts missing' },
      ],
      meta: { total: 2 },
    }
  })
})
