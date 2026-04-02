import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  isReplaying: false,
  asOf: null as string | null,
  currentUser: { id: 'user-1', email: 'cmd@test.mil', role: 'commander' },
  incidentsParams: null as Record<string, unknown> | null,
  incidentsOptions: null as { enabled?: boolean; refetchInterval?: number | false } | null,
}))

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({
    isReplaying: mockState.isReplaying,
    asOf: mockState.asOf,
  }),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: mockState.currentUser,
  }),
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => ({
    isCommander: mockState.currentUser?.role === 'commander',
    isOperator: mockState.currentUser?.role === 'operator',
    isViewer: mockState.currentUser?.role === 'viewer',
  }),
}))

vi.mock('../hooks/useIncidents', () => ({
  useIncidents: (params?: Record<string, unknown>, options?: { enabled?: boolean; refetchInterval?: number | false }) => {
    mockState.incidentsParams = params ?? null
    mockState.incidentsOptions = options ?? null

    return {
      data: {
        data: [
          {
            id: 'inc-1',
            title: 'Harbor breach watch',
            description: null,
            status: 'open',
            severity: 'high',
            confidence: 0.83,
            opened_at: '2026-03-29T10:00:00Z',
            acknowledged_at: null,
            closed_at: null,
            fusion_rationale: null,
            alert_count: 1,
            task_count: 0,
            assigned_to: null,
            assigned_at: null,
            site: { id: 'site-1', name: 'Port Alpha' },
            area_of_operation: null,
            prosecution_phase: null,
            prosecution_initiated_at: null,
            prosecuted_by: null,
            created_at: '2026-03-29T10:00:00Z',
            updated_at: '2026-03-29T10:00:00Z',
          },
        ],
        meta: { total: 1, page: 1, per_page: 50, total_pages: 1 },
      },
      isPending: false,
      error: null,
    }
  },
  useTransitionIncident: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useAssignIncident: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}))

async function renderPage() {
  const { default: IncidentsPage } = await import('../pages/IncidentsPage')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <IncidentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('IncidentsPage', () => {
  beforeEach(() => {
    mockState.isReplaying = false
    mockState.asOf = null
    mockState.incidentsParams = null
    mockState.incidentsOptions = null
  })

  it('passes as_of and disables polling during replay', async () => {
    mockState.isReplaying = true
    mockState.asOf = '2026-03-29T12:00:00Z'

    await renderPage()

    expect(screen.getByText(/showing incidents as they existed at the replay timestamp/i)).toBeInTheDocument()
    expect(mockState.incidentsParams).toMatchObject({ as_of: '2026-03-29T12:00:00Z' })
    expect(mockState.incidentsOptions).toMatchObject({ enabled: true, refetchInterval: false })
    expect(screen.getByText('1 visible')).toBeInTheDocument()
  })

  it('hides transition and assignment actions for viewer role', async () => {
    mockState.currentUser = { id: 'viewer-1', email: 'viewer@test.mil', role: 'viewer' }

    await renderPage()

    expect(screen.queryByRole('button', { name: /acknowledge/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /take/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /drop/i })).not.toBeInTheDocument()
  })
})
