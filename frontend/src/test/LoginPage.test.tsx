import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const loginMock = vi.hoisted(() => vi.fn())
const setUserMock = vi.hoisted(() => vi.fn())
const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('../api/auth', () => ({ login: loginMock }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ login: setUserMock }),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

import LoginPage from '../pages/LoginPage'

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  it('renders the login form with brand and fields', () => {
    renderLogin()

    expect(screen.getByText('RESILIENCE')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('disables submit when fields are empty', () => {
    renderLogin()

    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled()
  })

  it('shows error on failed login', async () => {
    loginMock.mockRejectedValue(new Error('bad credentials'))
    const user = userEvent.setup()

    renderLogin()

    await user.type(screen.getByLabelText('Email'), 'test@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument()
  })

  it('navigates on successful login', async () => {
    loginMock.mockResolvedValue({ user: { id: '1', email: 'test@example.com', role: 'operator' } })
    const user = userEvent.setup()

    renderLogin()

    await user.type(screen.getByLabelText('Email'), 'test@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await vi.waitFor(() => {
      expect(setUserMock).toHaveBeenCalled()
      expect(navigateMock).toHaveBeenCalledWith('/sites', { replace: true })
    })
  })
})
