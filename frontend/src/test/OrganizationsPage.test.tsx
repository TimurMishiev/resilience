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

const mockOrgs = vi.hoisted(() => ({
  data: [
    {
      id: 'org-1',
      name: 'Alpha Corp',
      slug: 'alpha-corp',
      user_count: 3,
      site_count: 2,
      created_at: '2026-04-01T10:00:00Z',
      updated_at: '2026-04-01T10:00:00Z',
    },
    {
      id: 'org-2',
      name: 'Bravo Unit',
      slug: 'bravo-unit',
      user_count: 0,
      site_count: 0,
      created_at: '2026-04-02T10:00:00Z',
      updated_at: '2026-04-02T10:00:00Z',
    },
  ],
  meta: { page: 1, per_page: 25, total: 2, total_pages: 1 },
}))

const apiMocks = vi.hoisted(() => ({
  getOrganizations: vi.fn(),
  createOrganization: vi.fn(),
  updateOrganization: vi.fn(),
  deleteOrganization: vi.fn(),
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

vi.mock('../api/organizations', () => ({
  getOrganizations: (...args: unknown[]) => apiMocks.getOrganizations(...args),
  createOrganization: (...args: unknown[]) => apiMocks.createOrganization(...args),
  updateOrganization: (...args: unknown[]) => apiMocks.updateOrganization(...args),
  deleteOrganization: (...args: unknown[]) => apiMocks.deleteOrganization(...args),
}))

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

async function renderPage() {
  const { default: OrganizationsPage } = await import('../pages/OrganizationsPage')
  return render(
    <QueryClientProvider client={queryClient()}>
      <MemoryRouter>
        <OrganizationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('OrganizationsPage', () => {
  beforeEach(() => {
    Object.assign(mockRole, {
      role: 'admin',
      isAdmin: true,
      isCommander: true,
      isOperator: false,
      isViewer: false,
    })
    apiMocks.getOrganizations.mockResolvedValue(mockOrgs)
    apiMocks.createOrganization.mockReset()
    apiMocks.updateOrganization.mockReset()
    apiMocks.deleteOrganization.mockReset()
  })

  it('renders organization table for admin users', async () => {
    await renderPage()

    expect(await screen.findByText('Alpha Corp')).toBeInTheDocument()
    expect(screen.getByText('Bravo Unit')).toBeInTheDocument()
    expect(screen.getByText('alpha-corp')).toBeInTheDocument()
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
    expect(screen.queryByText('Alpha Corp')).not.toBeInTheDocument()
  })

  it('opens create dialog and submits new organization', async () => {
    apiMocks.createOrganization.mockResolvedValue({
      id: 'org-3', name: 'Charlie Ops', slug: 'charlie-ops',
      user_count: 0, site_count: 0,
      created_at: '2026-04-03T10:00:00Z', updated_at: '2026-04-03T10:00:00Z',
    })
    const user = userEvent.setup()
    await renderPage()

    await screen.findByText('Alpha Corp')
    await user.click(screen.getByText('New Organization'))

    const dialog = screen.getByRole('dialog')
    const nameInput = within(dialog).getByPlaceholderText('Acme Operations')
    await user.type(nameInput, 'Charlie Ops')

    // Auto-slug should have populated
    const slugInput = within(dialog).getByPlaceholderText('acme-operations')
    expect(slugInput).toHaveValue('charlie-ops')

    await user.click(within(dialog).getByText('Create'))

    expect(apiMocks.createOrganization).toHaveBeenCalledWith({
      name: 'Charlie Ops',
      slug: 'charlie-ops',
    })
  })

  it('opens edit dialog pre-filled with org data', async () => {
    const user = userEvent.setup()
    await renderPage()

    await screen.findByText('Alpha Corp')
    // Blueprint icon-only buttons have no accessible name; find via the table row
    const row = screen.getByText('Alpha Corp').closest('tr')!
    const buttons = within(row).getAllByRole('button')
    await user.click(buttons[0]) // first button in row = edit

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByDisplayValue('Alpha Corp')).toBeInTheDocument()
    expect(within(dialog).getByDisplayValue('alpha-corp')).toBeInTheDocument()
    expect(within(dialog).getByText('Save')).toBeInTheDocument()
  })

  it('disables delete button when org has users or sites', async () => {
    await renderPage()

    await screen.findByText('Alpha Corp')

    // Alpha Corp has users/sites — its delete button should be disabled
    const trashButtons = screen.getAllByRole('button').filter(
      btn => btn.querySelector('.bp5-icon-trash, [data-icon="trash"]') !== null
    )
    // First trash = Alpha (disabled), second trash = Bravo (enabled)
    expect(trashButtons).toHaveLength(2)
    expect(trashButtons[0]).toBeDisabled()
    expect(trashButtons[1]).not.toBeDisabled()
  })

  it('shows error callout when API returns an error', async () => {
    apiMocks.getOrganizations.mockRejectedValue(new Error('Network failure'))

    await renderPage()

    expect(await screen.findByText(/network failure/i)).toBeInTheDocument()
  })
})
