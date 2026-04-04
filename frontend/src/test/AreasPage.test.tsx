import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  isReplaying: false,
  isCommander: true,
  areas: {
    data: {
      data: [
        {
          id: 'ao-1', name: 'EUCOM', description: 'European Command',
          threat_level: 'amber' as const, color: '#ffb347',
          posture: 'defensive' as const,
          geometry: { type: 'Polygon' as const, coordinates: [[[5,38],[40,38],[40,55],[5,55],[5,38]]] },
        },
      ],
    },
    isLoading: false,
    error: null as Error | null,
  },
}))

vi.mock('../hooks/useAreasOfOperation', () => ({
  useAreasOfOperation: () => mockState.areas,
  useCreateAreaOfOperation: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAreaOfOperation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAreaOfOperation: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../hooks/useSites', () => ({
  useSites: () => ({ data: { data: [] } }),
}))
vi.mock('../hooks/useCorrelationRules', () => ({
  useCorrelationRules: () => ({ data: { data: [] } }),
}))
vi.mock('../hooks/useRole', () => ({
  useRole: () => ({ isCommander: mockState.isCommander }),
}))
vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({ isReplaying: mockState.isReplaying }),
}))
vi.mock('../components/PostureSelector', () => ({
  PostureSelector: () => <span>PostureSelector</span>,
}))
vi.mock('../components/PostureBadge', () => ({
  PostureBadge: () => <span>PostureBadge</span>,
}))

import AreasPage from '../pages/AreasPage'

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AreasPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AreasPage', () => {
  beforeEach(() => {
    mockState.isReplaying = false
    mockState.isCommander = true
    mockState.areas.error = null
  })

  it('renders area table with data', () => {
    renderPage()

    expect(screen.getByText('Areas of Operation')).toBeInTheDocument()
    expect(screen.getByText('EUCOM')).toBeInTheDocument()
    expect(screen.getByText('AMBER')).toBeInTheDocument()
  })

  it('shows create button for commanders only', () => {
    renderPage()
    expect(screen.getByText('New Area')).toBeInTheDocument()

    mockState.isCommander = false
    renderPage()
    expect(screen.queryAllByText('New Area')).toHaveLength(1) // only from the first render
  })

  it('shows replay unavailable state during replay', () => {
    mockState.isReplaying = true

    renderPage()

    expect(screen.getByText('Areas of Operation unavailable in replay')).toBeInTheDocument()
  })
})
