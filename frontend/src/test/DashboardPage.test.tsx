import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dashboardState = vi.hoisted(() => ({
  isReplaying: false,
  asOf: '2026-04-09T12:00:00Z',
  referenceTimeMs: Date.parse('2026-03-27T11:30:00.000Z'),
  loiteringError: null as Error | null,
  recommendations: [] as Array<{ id: string }>,
  matches: [] as Array<Record<string, unknown>>,
  loiteringVessels: [
    {
      id: 'vessel-1',
      mmsi: '123456789',
      name: 'MV Sentinel',
      vessel_type: 'Cargo',
      flag: 'PA',
      destination: 'Tangier',
      lat: 36.1,
      lng: -5.4,
      speed: 0.8,
      heading: 210,
      first_seen_at: '2026-03-25T00:00:00.000Z',
      last_seen_at: '2026-03-27T11:30:00.000Z',
      loitering_since: '2026-03-27T11:00:00.000Z',
      dark: true,
      loitering: true,
      last_signal_id: 'sig-1',
    },
  ],
}))

vi.mock('recharts', () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    ResponsiveContainer: Passthrough,
    BarChart: Passthrough,
    Bar: Passthrough,
    Cell: Passthrough,
    XAxis: Passthrough,
    YAxis: Passthrough,
    Tooltip: Passthrough,
    LineChart: Passthrough,
    Line: Passthrough,
    CartesianGrid: Passthrough,
  }
})

vi.mock('../hooks/useReadiness', () => ({
  useReadiness: () => ({
    data: [],
    isPending: false,
    error: null,
  }),
  useThroughput: () => ({
    data: { data: [] },
  }),
}))

vi.mock('../hooks/useRiskScores', () => ({
  useRiskScores: () => ({
    data: [],
  }),
}))

vi.mock('../hooks/useTasks', () => ({
  useTasks: () => ({
    data: { data: [] },
    isPending: false,
  }),
}))

vi.mock('../hooks/useSignalRuleMatches', () => ({
  useSignalRuleMatches: () => ({
    data: { data: dashboardState.matches },
  }),
  useTransitionAlert: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useBulkTransitionAlerts: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('../hooks/useVessels', () => ({
  useVessels: () => ({
    data: { data: dashboardState.loiteringVessels },
    isPending: false,
    error: dashboardState.loiteringError,
  }),
}))

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({
    asOf: dashboardState.asOf,
    isReplaying: dashboardState.isReplaying,
  }),
}))

vi.mock('../hooks/useReferenceTimeMs', () => ({
  useReferenceTimeMs: () => dashboardState.referenceTimeMs,
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => ({
    isCommander: true,
  }),
}))

vi.mock('../hooks/useRecommendations', () => ({
  useRecommendations: () => ({
    data: { data: dashboardState.recommendations },
  }),
}))

vi.mock('../components/AlertChainDrawer', () => ({
  default: () => null,
}))

vi.mock('../components/RecommendationCard', () => ({
  default: () => <div>Recommendation card</div>,
}))

vi.mock('../components/EvidenceDrawer', () => ({
  default: () => null,
}))

import DashboardPage from '../pages/DashboardPage'

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('DashboardPage loitering watchlist', () => {
  beforeEach(() => {
    dashboardState.isReplaying = false
    dashboardState.referenceTimeMs = Date.parse('2026-03-27T11:30:00.000Z')
    dashboardState.recommendations = []
    dashboardState.matches = []
    dashboardState.loiteringError = null
  })

  it('renders the live loitering watchlist', () => {
    renderDashboard()

    expect(screen.getByText('Loitering Watchlist')).toBeInTheDocument()
    expect(screen.getByText('MV Sentinel')).toBeInTheDocument()
    expect(screen.getByText('123456789 · PA · Cargo')).toBeInTheDocument()
    expect(screen.getByText('Loitering 30m')).toBeInTheDocument()
    expect(screen.getByText('Dark')).toBeInTheDocument()
  })

  it('hides the watchlist during replay mode', () => {
    dashboardState.isReplaying = true

    renderDashboard()

    expect(screen.queryByText('Loitering Watchlist')).not.toBeInTheDocument()
  })

  it('keeps alerts and recommendations visible during replay', () => {
    dashboardState.isReplaying = true
    dashboardState.matches = [
      {
        id: 'match-1',
        fired_at: '2026-04-09T11:00:00Z',
        workflow_status: 'unacknowledged',
        confidence: 0.92,
        metadata: {},
        signal: null,
        correlation_rule: { id: 'rule-1', name: 'Historical Rule' },
        site: { id: 'site-1', name: 'Forward Site Alpha' },
        task: null,
      },
    ]
    dashboardState.recommendations = [
      { id: 'rec-1' } as never,
    ]

    renderDashboard()

    expect(screen.getByText(/Viewing historical dashboard state/i)).toBeInTheDocument()
    expect(screen.getByText('Recent Alerts')).toBeInTheDocument()
    expect(screen.getByText('Historical Rule')).toBeInTheDocument()
    expect(screen.getByText('Recommendations')).toBeInTheDocument()
    expect(screen.getByText('Recommendation card')).toBeInTheDocument()
  })

  it('renders an explicit error state when loitering data fails to load', () => {
    dashboardState.loiteringError = new Error('upstream timeout')

    renderDashboard()

    expect(screen.getByText('Loitering Watchlist')).toBeInTheDocument()
    expect(screen.getByText('Failed to load loitering watchlist: upstream timeout')).toBeInTheDocument()
    expect(screen.queryByText('No vessels are currently flagged as loitering.')).not.toBeInTheDocument()
  })
})
