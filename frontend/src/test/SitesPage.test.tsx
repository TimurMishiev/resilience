import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  isReplaying: false,
  sites: {
    data: {
      data: [
        { id: 's1', name: 'Alpha Base', status: 'active', latitude: '26.5', longitude: '56.2', flagged_at: null, flag_reason: null, area_of_operation_id: null },
        { id: 's2', name: 'Bravo Outpost', status: 'inactive', latitude: '25.0', longitude: '55.0', flagged_at: '2026-04-01T00:00:00Z', flag_reason: 'High risk', area_of_operation_id: null },
      ],
      meta: { total: 2 },
    },
    error: null as Error | null,
    isPending: false,
  },
  riskScores: [] as { site_id: string; score: number; risk_level: string; components: { alert_pressure: number; task_health: number; signal_density: number } }[],
}))

vi.mock('../hooks/useSites', () => ({
  useSites: () => mockState.sites,
}))
vi.mock('../hooks/useRiskScores', () => ({
  useRiskScores: () => ({ data: mockState.riskScores }),
}))
vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({ asOf: null, isReplaying: mockState.isReplaying }),
}))

import SitesPage from '../pages/SitesPage'

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SitesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SitesPage', () => {
  beforeEach(() => {
    mockState.isReplaying = false
    mockState.sites.error = null
    mockState.sites.isPending = false
  })

  it('renders site table with data', () => {
    renderPage()

    expect(screen.getByText('Sites')).toBeInTheDocument()
    expect(screen.getByText('2 total')).toBeInTheDocument()
    expect(screen.getByText('Alpha Base')).toBeInTheDocument()
    expect(screen.getByText('Bravo Outpost')).toBeInTheDocument()
  })

  it('shows flagged badge on flagged sites', () => {
    renderPage()

    expect(screen.getByText('flagged')).toBeInTheDocument()
  })

  it('shows error callout on fetch failure', () => {
    mockState.sites.error = new Error('Connection refused')

    renderPage()

    expect(screen.getByText('Failed to load sites')).toBeInTheDocument()
    expect(screen.getByText('Connection refused')).toBeInTheDocument()
  })

  it('shows replay warning when replaying', () => {
    mockState.isReplaying = true

    renderPage()

    expect(screen.getByText(/latest recorded snapshot at the replay timestamp/i)).toBeInTheDocument()
  })
})
