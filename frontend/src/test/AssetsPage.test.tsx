import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  assets: {
    data: {
      data: [
        { id: 'a1', name: 'Drone Alpha', asset_type: 'UAV', status: 'available' as const, home_site_id: 's1', last_reported_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'a2', name: 'Patrol Boat', asset_type: 'vessel', status: 'assigned' as const, home_site_id: 's1', last_reported_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      ],
      meta: { total: 2 },
    },
    error: null as Error | null,
    isPending: false,
  },
}))

vi.mock('../hooks/useAssets', () => ({
  useAssets: () => mockState.assets,
}))
vi.mock('../hooks/useSites', () => ({
  useSites: () => ({ data: { data: [{ id: 's1', name: 'Alpha Base' }] }, isPending: false }),
}))
vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({ asOf: null, isReplaying: false }),
}))
vi.mock('../hooks/useReferenceTimeMs', () => ({
  useReferenceTimeMs: () => Date.now(),
}))
vi.mock('../components/EntityCard', () => ({
  default: () => <div>EntityCard</div>,
}))

import AssetsPage from '../pages/AssetsPage'

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AssetsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AssetsPage', () => {
  beforeEach(() => {
    mockState.assets.error = null
    mockState.assets.isPending = false
  })

  it('renders asset table with data', () => {
    renderPage()

    expect(screen.getByText('Assets')).toBeInTheDocument()
    expect(screen.getByText('2 total')).toBeInTheDocument()
    expect(screen.getByText('Drone Alpha')).toBeInTheDocument()
    expect(screen.getByText('Patrol Boat')).toBeInTheDocument()
    expect(screen.getAllByText('Alpha Base')).toHaveLength(2)
  })

  it('shows error callout on fetch failure', () => {
    mockState.assets.error = new Error('Connection refused')

    renderPage()

    expect(screen.getByText('Failed to load assets')).toBeInTheDocument()
    expect(screen.getByText('Connection refused')).toBeInTheDocument()
  })

  it('shows empty state when no assets', () => {
    mockState.assets.data = { data: [], meta: { total: 0 } }
    mockState.assets.isPending = false

    renderPage()

    expect(screen.getByText('No assets')).toBeInTheDocument()

    // Restore
    mockState.assets.data = {
      data: [
        { id: 'a1', name: 'Drone Alpha', asset_type: 'UAV', status: 'available' as const, home_site_id: 's1', last_reported_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'a2', name: 'Patrol Boat', asset_type: 'vessel', status: 'assigned' as const, home_site_id: 's1', last_reported_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      ],
      meta: { total: 2 },
    }
  })
})
