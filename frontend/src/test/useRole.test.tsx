import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useRole } from '../hooks/useRole'

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../context/AuthContext'

const mockUseAuth = vi.mocked(useAuth)

function RoleHarness() {
  const role = useRole()

  return (
    <pre data-testid="role-state">
      {JSON.stringify(role)}
    </pre>
  )
}

describe('useRole', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('treats admin as commander-capable and admin-capable', () => {
    mockUseAuth.mockReturnValue({
      currentUser: { id: '1', email: 'admin@test.mil', role: 'admin' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
    })

    render(<RoleHarness />)
    const state = JSON.parse(screen.getByTestId('role-state').textContent ?? '{}')

    expect(state.isAdmin).toBe(true)
    expect(state.isCommander).toBe(true)
    expect(state.canAccessPlanning).toBe(true)
    expect(state.canManageUsers).toBe(true)
    expect(state.canManageOrganizations).toBe(true)
    expect(state.canReviewRecommendations).toBe(true)
  })

  it('gives operators operational but not commander capabilities', () => {
    mockUseAuth.mockReturnValue({
      currentUser: { id: '2', email: 'operator@test.mil', role: 'operator' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
    })

    render(<RoleHarness />)
    const state = JSON.parse(screen.getByTestId('role-state').textContent ?? '{}')

    expect(state.isOperator).toBe(true)
    expect(state.isCommander).toBe(false)
    expect(state.canOperateIncidents).toBe(true)
    expect(state.canOperateTasks).toBe(true)
    expect(state.canTriageAlerts).toBe(true)
    expect(state.canAccessPlanning).toBe(false)
    expect(state.canManageCorrelationRules).toBe(false)
  })

  it('defaults unauthenticated users to the most restrictive viewer capability set', () => {
    mockUseAuth.mockReturnValue({
      currentUser: null,
      isAuthenticated: false,
      login: vi.fn(),
      logout: vi.fn(),
    })

    render(<RoleHarness />)
    const state = JSON.parse(screen.getByTestId('role-state').textContent ?? '{}')

    expect(state.role).toBe('viewer')
    expect(state.isViewer).toBe(true)
    expect(state.canAccessBriefing).toBe(false)
    expect(state.canManageUsers).toBe(false)
    expect(state.canOperateTasks).toBe(false)
  })
})
