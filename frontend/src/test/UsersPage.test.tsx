import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRole = vi.hoisted(() => ({
  role: 'admin' as string,
  isAdmin: true,
  isCommander: true,
  isOperator: false,
  isViewer: false,
}))

const mockUsers = vi.hoisted(() => ({
  data: [
    {
      id: 'usr-1',
      email: 'alice@ops.test',
      role: 'commander',
      organization_id: 'org-1',
      organization_name: 'Alpha Corp',
      area_of_operation_id: null,
      area_of_operation_name: null,
      created_at: '2026-04-01T10:00:00Z',
      updated_at: '2026-04-01T10:00:00Z',
    },
    {
      id: 'usr-2',
      email: 'bob@ops.test',
      role: 'viewer',
      organization_id: null,
      organization_name: null,
      area_of_operation_id: null,
      area_of_operation_name: null,
      created_at: '2026-04-02T10:00:00Z',
      updated_at: '2026-04-02T10:00:00Z',
    },
  ],
  meta: { page: 1, per_page: 25, total: 2, total_pages: 1 },
}))

const mockOrgs = vi.hoisted(() => ({
  data: [
    { id: 'org-1', name: 'Alpha Corp', slug: 'alpha-corp', user_count: 1, site_count: 0, created_at: '2026-04-01T10:00:00Z', updated_at: '2026-04-01T10:00:00Z' },
    { id: 'org-2', name: 'Bravo Unit', slug: 'bravo-unit', user_count: 0, site_count: 0, created_at: '2026-04-01T10:00:00Z', updated_at: '2026-04-01T10:00:00Z' },
  ],
  meta: { page: 1, per_page: 25, total: 2, total_pages: 1 },
}))

const apiMocks = vi.hoisted(() => ({
  getUsers: vi.fn(),
  updateUser: vi.fn(),
  getOrganizations: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: {
      id: 'admin-1',
      email: 'admin@resilience.test',
      role: mockRole.role,
      organization_id: null,
      area_of_operation_id: null,
    },
  }),
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => mockRole,
}))

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({ asOf: null, isReplaying: false }),
}))

vi.mock('../api/users', () => ({
  getUsers: (...args: unknown[]) => apiMocks.getUsers(...args),
  updateUser: (...args: unknown[]) => apiMocks.updateUser(...args),
}))

vi.mock('../api/organizations', () => ({
  getOrganizations: (...args: unknown[]) => apiMocks.getOrganizations(...args),
}))

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

async function renderPage() {
  const { default: UsersPage } = await import('../pages/UsersPage')
  return render(
    <QueryClientProvider client={queryClient()}>
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('UsersPage', () => {
  beforeEach(() => {
    Object.assign(mockRole, {
      role: 'admin',
      isAdmin: true,
      isCommander: true,
      isOperator: false,
      isViewer: false,
    })
    apiMocks.getUsers.mockResolvedValue(mockUsers)
    apiMocks.getOrganizations.mockResolvedValue(mockOrgs)
    apiMocks.updateUser.mockReset()
  })

  it('renders user table for admin users', async () => {
    await renderPage()

    expect(await screen.findByText('alice@ops.test')).toBeInTheDocument()
    expect(screen.getByText('bob@ops.test')).toBeInTheDocument()
    expect(screen.getByText('Alpha Corp')).toBeInTheDocument()
  })

  it('shows admin-access-required callout for non-admin users', async () => {
    Object.assign(mockRole, {
      role: 'operator',
      isAdmin: false,
      isCommander: false,
      isOperator: true,
      isViewer: false,
    })

    await renderPage()

    expect(screen.getByText(/admin access required/i)).toBeInTheDocument()
    expect(screen.queryByText('alice@ops.test')).not.toBeInTheDocument()
  })

  it('opens edit dialog and submits org assignment', async () => {
    apiMocks.updateUser.mockResolvedValue({
      ...mockUsers.data[1],
      organization_id: 'org-2',
      organization_name: 'Bravo Unit',
    })
    const user = userEvent.setup()
    await renderPage()

    await screen.findByText('alice@ops.test')
    const row = screen.getByText('bob@ops.test').closest('tr')!
    const editBtn = within(row).getByRole('button')
    await user.click(editBtn)

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/bob@ops\.test/)).toBeInTheDocument()

    const orgSelect = within(dialog).getByLabelText('Organization')
    await user.selectOptions(orgSelect, 'org-2')

    await user.click(within(dialog).getByText('Save'))

    expect(apiMocks.updateUser).toHaveBeenCalledWith('usr-2', {
      role: 'viewer',
      organization_id: 'org-2',
    })
  })

  it('shows error callout when API returns an error', async () => {
    apiMocks.getUsers.mockRejectedValue(new Error('Network failure'))

    await renderPage()

    expect(await screen.findByText(/network failure/i)).toBeInTheDocument()
  })
})
