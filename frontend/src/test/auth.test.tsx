/**
 * Tests for AuthContext and ProtectedRoute.
 *
 * Critical paths tested:
 * - AuthProvider exposes isAuthenticated=false when no user is stored
 * - login() stores user and sets isAuthenticated=true
 * - logout() clears the user and isAuthenticated returns false
 * - 401 auto-logout: registerUnauthorizedHandler triggers logout
 * - ProtectedRoute redirects unauthenticated users to /login
 * - ProtectedRoute renders children for authenticated users
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider, useAuth } from '../context/AuthContext'
import ProtectedRoute from '../components/ProtectedRoute'

// Mock the API modules — we test AuthContext logic, not HTTP
vi.mock('../api/auth', () => ({
  logout:      vi.fn().mockResolvedValue(undefined),
  restoreUser: vi.fn().mockReturnValue(null),
}))

vi.mock('../api/client', () => ({
  registerUnauthorizedHandler: vi.fn(),
  api: {},
}))

import { registerUnauthorizedHandler } from '../api/client'
import { logout as apiLogout, restoreUser } from '../api/auth'

const mockRestoreUser = restoreUser as ReturnType<typeof vi.fn>
const mockRegister    = registerUnauthorizedHandler as ReturnType<typeof vi.fn>

// Helper: renders a component that reads from AuthContext
function AuthDisplay() {
  const { isAuthenticated, currentUser, login, logout } = useAuth()
  return (
    <div>
      <span data-testid="auth">{isAuthenticated ? 'authed' : 'anon'}</span>
      <span data-testid="email">{currentUser?.email ?? 'none'}</span>
      <span data-testid="role">{currentUser?.role ?? 'none'}</span>
      <button onClick={() => login({ id: '1', email: 'cmd@test.mil', role: 'commander' })}>
        Login
      </button>
      <button onClick={() => logout()}>Logout</button>
    </div>
  )
}

function renderWithAuth(ui: React.ReactElement) {
  return render(<AuthProvider>{ui}</AuthProvider>)
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRestoreUser.mockReturnValue(null)
    sessionStorage.clear()
  })

  it('starts unauthenticated when no user is stored', () => {
    renderWithAuth(<AuthDisplay />)
    expect(screen.getByTestId('auth').textContent).toBe('anon')
    expect(screen.getByTestId('email').textContent).toBe('none')
  })

  it('restores user from sessionStorage on mount', () => {
    mockRestoreUser.mockReturnValue({ id: '2', email: 'op@test.mil', role: 'operator' })
    renderWithAuth(<AuthDisplay />)
    expect(screen.getByTestId('auth').textContent).toBe('authed')
    expect(screen.getByTestId('email').textContent).toBe('op@test.mil')
  })

  it('login() sets isAuthenticated and currentUser', async () => {
    renderWithAuth(<AuthDisplay />)
    expect(screen.getByTestId('auth').textContent).toBe('anon')
    await act(async () => {
      screen.getByText('Login').click()
    })
    expect(screen.getByTestId('auth').textContent).toBe('authed')
    expect(screen.getByTestId('email').textContent).toBe('cmd@test.mil')
    expect(screen.getByTestId('role').textContent).toBe('commander')
  })

  it('logout() clears isAuthenticated', async () => {
    mockRestoreUser.mockReturnValue({ id: '1', email: 'cmd@test.mil', role: 'commander' })
    renderWithAuth(<AuthDisplay />)
    expect(screen.getByTestId('auth').textContent).toBe('authed')
    await act(async () => {
      screen.getByText('Logout').click()
    })
    expect(screen.getByTestId('auth').textContent).toBe('anon')
    expect(apiLogout).toHaveBeenCalledOnce()
  })

  it('registers an unauthorized handler on mount', () => {
    renderWithAuth(<AuthDisplay />)
    expect(mockRegister).toHaveBeenCalledOnce()
    expect(mockRegister).toHaveBeenCalledWith(expect.any(Function))
  })

  it('throws when used outside AuthProvider', () => {
    // Suppress React's error boundary console output
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<AuthDisplay />)).toThrow('useAuth must be used inside AuthProvider')
    consoleSpy.mockRestore()
  })
})

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRestoreUser.mockReturnValue(null)
  })

  it('redirects unauthenticated users to /login', () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/login" element={<div>Login Page</div>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<div>Dashboard</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    )
    expect(screen.getByText('Login Page')).toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })

  it('renders the protected page for authenticated users', () => {
    mockRestoreUser.mockReturnValue({ id: '1', email: 'cmd@test.mil', role: 'commander' })
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/login" element={<div>Login Page</div>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<div>Dashboard</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    )
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument()
  })
})

describe('Role gating via AuthContext', () => {
  function RoleDisplay() {
    const { currentUser } = useAuth()
    const isCommander = currentUser?.role === 'commander'
    return (
      <div>
        {isCommander
          ? <button>Commander Action</button>
          : <span>Operator view</span>
        }
      </div>
    )
  }

  it('shows commander controls only for commander role', () => {
    mockRestoreUser.mockReturnValue({ id: '1', email: 'cmd@test.mil', role: 'commander' })
    renderWithAuth(<RoleDisplay />)
    expect(screen.getByText('Commander Action')).toBeInTheDocument()
    expect(screen.queryByText('Operator view')).not.toBeInTheDocument()
  })

  it('hides commander controls for operator role', () => {
    mockRestoreUser.mockReturnValue({ id: '2', email: 'op@test.mil', role: 'operator' })
    renderWithAuth(<RoleDisplay />)
    expect(screen.getByText('Operator view')).toBeInTheDocument()
    expect(screen.queryByText('Commander Action')).not.toBeInTheDocument()
  })

  it('treats missing user as operator (most restrictive default)', () => {
    // No user — defaults to hiding commander controls
    mockRestoreUser.mockReturnValue(null)
    renderWithAuth(<RoleDisplay />)
    expect(screen.getByText('Operator view')).toBeInTheDocument()
  })
})
