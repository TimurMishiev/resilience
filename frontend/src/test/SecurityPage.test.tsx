import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  currentUser: {
    id: 'user-1',
    email: 'commander@resilience.test',
    role: 'commander',
    organization_id: 'org-1' as string | null,
    area_of_operation_id: 'ao-1' as string | null,
  },
  sessionsParams: null as Record<string, unknown> | null,
  sessions: [
    {
      id: 'sess-current',
      user_id: 'user-1',
      user_email: 'commander@resilience.test',
      current: true,
      ip_address: '127.0.0.1',
      user_agent: 'Current Browser',
      last_seen_at: '2026-04-02T10:00:00Z',
      created_at: '2026-04-01T10:00:00Z',
      expires_at: '2026-04-03T10:00:00Z',
      revoked_at: null,
      revoke_reason: null,
      revoked_by_email: null,
    },
    {
      id: 'sess-other',
      user_id: 'user-1',
      user_email: 'commander@resilience.test',
      current: false,
      ip_address: '127.0.0.2',
      user_agent: 'Other Browser',
      last_seen_at: '2026-04-02T09:00:00Z',
      created_at: '2026-04-01T09:00:00Z',
      expires_at: '2026-04-03T09:00:00Z',
      revoked_at: null,
      revoke_reason: null,
      revoked_by_email: null,
    },
  ],
  revokeSession: vi.fn().mockResolvedValue(undefined),
  revokeAll: vi.fn().mockResolvedValue(undefined),
}))
const logoutMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: mockState.currentUser,
  }),
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => ({
    role: mockState.currentUser.role,
    isAdmin: mockState.currentUser.role === 'admin',
    isCommander: mockState.currentUser.role === 'commander' || mockState.currentUser.role === 'admin',
    isOperator: mockState.currentUser.role === 'operator',
    isViewer: mockState.currentUser.role === 'viewer',
  }),
}))

vi.mock('../hooks/useUserSessions', () => ({
  useUserSessions: (params?: Record<string, unknown>) => {
    mockState.sessionsParams = params ?? null
    return {
      data: {
        data: mockState.sessions,
        meta: {
          user_id: 'user-1',
          user_email: params?.user_email ?? mockState.currentUser.email,
        },
      },
      isPending: false,
      isError: false,
      error: null,
    }
  },
  useRevokeUserSession: () => ({
    isPending: false,
    mutateAsync: mockState.revokeSession,
  }),
  useRevokeAllUserSessions: () => ({
    isPending: false,
    mutateAsync: mockState.revokeAll,
  }),
}))

vi.mock('../api/auth', () => ({
  logout: logoutMock,
}))

async function renderPage() {
  const { default: SecurityPage } = await import('../pages/SecurityPage')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SecurityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SecurityPage', () => {
  beforeEach(() => {
    mockState.currentUser = {
      id: 'user-1',
      email: 'commander@resilience.test',
      role: 'commander',
      organization_id: 'org-1',
      area_of_operation_id: 'ao-1',
    }
    mockState.sessionsParams = null
    mockState.revokeSession.mockClear()
    mockState.revokeAll.mockClear()
    logoutMock.mockReset()
    logoutMock.mockResolvedValue(undefined)
  })

  it('shows access scope and allows revoking another session', async () => {
    const user = userEvent.setup()
    await renderPage()

    expect(screen.getByText(/org: org-1/i)).toBeInTheDocument()
    expect(screen.getByText(/ao: ao-1/i)).toBeInTheDocument()
    expect(screen.getByText(/current session/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /revoke/i }))

    expect(mockState.revokeSession).toHaveBeenCalledWith({ id: 'sess-other', params: undefined })
  })

  it('allows admins to target another user email', async () => {
    const user = userEvent.setup()
    mockState.currentUser = {
      id: 'admin-1',
      email: 'admin@resilience.test',
      role: 'admin',
      organization_id: null,
      area_of_operation_id: null,
    }

    await renderPage()

    await user.type(screen.getByPlaceholderText(/user@resilience.test/i), 'viewer@resilience.test')
    await user.click(screen.getByRole('button', { name: /load sessions/i }))

    expect(mockState.sessionsParams).toEqual({ user_email: 'viewer@resilience.test' })
  })

  it('surfaces sign-out-all failures instead of treating them as success', async () => {
    const user = userEvent.setup()
    logoutMock.mockRejectedValue(new Error('session revoke failed'))

    await renderPage()
    await user.click(screen.getByRole('button', { name: /sign out all sessions/i }))

    expect(logoutMock).toHaveBeenCalledWith({ allSessions: true, suppressErrors: false })
    expect(await screen.findByText(/session revoke failed/i)).toBeInTheDocument()
  })
})
