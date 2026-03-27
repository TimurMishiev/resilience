import type { ComponentProps } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockNavigate = vi.hoisted(() => vi.fn())
const searchState = vi.hoisted(() => ({
  sites: [
    {
      id: 'site-1',
      name: 'Watchtower Bravo',
      latitude: 10,
      longitude: 20,
      status: 'active',
      area_of_operation_id: 'ao-1',
      geofence_radius_km: 10,
      created_at: '2026-03-27T12:00:00Z',
      updated_at: '2026-03-27T12:00:00Z',
      flagged_at: null,
      flag_reason: null,
    },
  ],
  tasks: [
    {
      id: 'task-1',
      site_id: 'site-1',
      asset_id: null,
      title: 'Patrol perimeter',
      description: null,
      priority: 'high',
      workflow_status: 'new',
      blocked_reason: null,
      resolved_at: null,
      created_at: '2026-03-27T12:00:00Z',
      updated_at: '2026-03-27T12:00:00Z',
      site_name: 'Watchtower Bravo',
      ao_id: 'ao-1',
      ao_posture: 'defensive',
    },
  ],
  assets: [
    {
      id: 'asset-1',
      name: 'Guardian 1',
      asset_type: 'uav',
      status: 'available',
      home_site_id: 'site-1',
      last_reported_at: null,
      created_at: '2026-03-27T12:00:00Z',
      updated_at: '2026-03-27T12:00:00Z',
    },
  ],
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('../hooks/useSites', () => ({
  useSites: () => ({ data: { data: searchState.sites } }),
}))

vi.mock('../hooks/useTasks', () => ({
  useTasks: () => ({ data: { data: searchState.tasks } }),
}))

vi.mock('../hooks/useAssets', () => ({
  useAssets: () => ({ data: { data: searchState.assets } }),
}))

vi.mock('../hooks/useReplayParams', () => ({
  useReplayParams: () => ({ asOfParam: {} }),
}))

import GlobalSearch from '../components/GlobalSearch'

function renderPalette(props?: Partial<ComponentProps<typeof GlobalSearch>>) {
  const onClose = vi.fn()
  const onLogout = vi.fn()

  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <GlobalSearch
        open
        isCommander
        onClose={onClose}
        onLogout={onLogout}
        {...props}
      />
    </MemoryRouter>,
  )

  return { onClose, onLogout }
}

describe('GlobalSearch', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
  })

  it('shows top command results immediately for commanders', () => {
    renderPalette()

    expect(screen.getByText('Open Planning')).toBeInTheDocument()
    expect(screen.getByText('Sign out')).toBeInTheDocument()
    expect(screen.getByText('Top commands are shown immediately. Start typing to narrow pages, actions, and entities.')).toBeInTheDocument()
  })

  it('runs the sign-out action from the command palette', async () => {
    const user = userEvent.setup()
    const { onClose, onLogout } = renderPalette()

    await user.type(screen.getByPlaceholderText(/Search commands, pages, sites, tasks, assets/i), 'sign out')
    await user.keyboard('{Enter}')

    expect(onLogout).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('navigates to a command result', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPalette()

    await user.type(screen.getByPlaceholderText(/Search commands, pages, sites, tasks, assets/i), 'planning')
    await user.keyboard('{Enter}')

    expect(mockNavigate).toHaveBeenCalledWith('/planning')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('still navigates to entity search results', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPalette()

    await user.type(screen.getByPlaceholderText(/Search commands, pages, sites, tasks, assets/i), 'watchtower')
    await user.click(screen.getByText('Watchtower Bravo'))

    expect(mockNavigate).toHaveBeenCalledWith('/sites/site-1')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('navigates to a task deep-link with ?task= param', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPalette()

    await user.type(screen.getByPlaceholderText(/Search commands, pages, sites, tasks, assets/i), 'patrol')
    await user.click(screen.getByText('Patrol perimeter'))

    expect(mockNavigate).toHaveBeenCalledWith('/sites/site-1?task=task-1')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('omits commander-only commands for operators', async () => {
    const user = userEvent.setup()
    renderPalette({ isCommander: false })

    expect(screen.queryByText('Open Planning')).not.toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/Search commands, pages, sites, tasks, assets/i), 'planning')

    await waitFor(() => {
      expect(screen.getByText('No results for "planning"')).toBeInTheDocument()
    })
  })
})
