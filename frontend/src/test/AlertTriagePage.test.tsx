import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockState = vi.hoisted(() => {
  const fetchNextPage = vi.fn()
  return {
    isReplaying: false,
    fetchNextPage,
    infiniteOptions: null as { enabled?: boolean; refetchInterval?: number | false } | null,
    data: {
      pages: [
        {
          data: [
            {
              id: 'match-1',
              fired_at: '2026-03-29T10:00:00Z',
              confidence: 0.91,
              workflow_status: 'unacknowledged',
              acknowledged_at: null,
              acknowledged_by: null,
              notes: null,
              metadata: {},
              signal: {
                id: 'sig-1',
                source: 'gpsjam',
                signal_type: 'gps_jamming',
                lat: 10,
                lng: 20,
                occurred_at: '2026-03-29T09:59:00Z',
              },
              correlation_rule: { id: 'rule-1', name: 'Rule Alpha' },
              site: { id: 'site-1', name: 'Site Alpha' },
              task: null,
            },
            {
              id: 'match-2',
              fired_at: '2026-03-29T09:30:00Z',
              confidence: 0.74,
              workflow_status: 'unacknowledged',
              acknowledged_at: null,
              acknowledged_by: null,
              notes: null,
              metadata: {},
              signal: {
                id: 'sig-2',
                source: 'usgs_seismic',
                signal_type: 'seismic_event',
                lat: 11,
                lng: 21,
                occurred_at: '2026-03-29T09:29:00Z',
              },
              correlation_rule: { id: 'rule-2', name: 'Rule Bravo' },
              site: { id: 'site-2', name: 'Site Bravo' },
              task: null,
            },
            {
              id: 'match-3',
              fired_at: '2026-03-29T09:00:00Z',
              confidence: 0.62,
              workflow_status: 'unacknowledged',
              acknowledged_at: null,
              acknowledged_by: null,
              notes: null,
              metadata: {},
              signal: {
                id: 'sig-3',
                source: 'gdacs',
                signal_type: 'disaster_alert',
                lat: 12,
                lng: 22,
                occurred_at: '2026-03-29T08:59:00Z',
              },
              correlation_rule: { id: 'rule-3', name: 'Rule Charlie' },
              site: { id: 'site-3', name: 'Site Charlie' },
              task: null,
            },
          ],
          meta: { total: 3, page: 1, per_page: 100, total_pages: 2 },
        },
      ],
    },
    disabledData: undefined,
  }
})

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 2) }, (_, index) => ({
        index,
        start: index * 86,
      })),
    getTotalSize: () => count * 86,
    measureElement: () => undefined,
    measure: () => undefined,
  }),
}))

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({
    isReplaying: mockState.isReplaying,
  }),
}))

vi.mock('../hooks/useSignalRuleMatches', () => ({
  useSignalRuleMatchesInfinite: (_params?: unknown, options?: { enabled?: boolean; refetchInterval?: number | false }) => {
    mockState.infiniteOptions = options ?? null
    return {
      data: options?.enabled === false ? mockState.disabledData : mockState.data,
      isLoading: false,
      error: null,
      fetchNextPage: mockState.fetchNextPage,
      hasNextPage: options?.enabled === false ? false : true,
      isFetchingNextPage: false,
    }
  },
  useTransitionAlert: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useBulkTransitionAlerts: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
}))

vi.mock('../components/AlertChainDrawer', () => ({
  default: () => null,
}))

import AlertTriagePage from '../pages/AlertTriagePage'

function renderAlertTriagePage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/alerts']}>
        <AlertTriagePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AlertTriagePage', () => {
  beforeEach(() => {
    mockState.isReplaying = false
    mockState.fetchNextPage.mockReset()
    mockState.infiniteOptions = null
  })

  it('renders a virtualized live alert list and keeps load-more interaction working', async () => {
    const user = userEvent.setup()
    const { container } = renderAlertTriagePage()

    expect(await screen.findByText('Rule Alpha')).toBeInTheDocument()
    expect(screen.getByText('Rule Bravo')).toBeInTheDocument()
    expect(screen.queryByText('Rule Charlie')).not.toBeInTheDocument()
    expect(screen.getAllByText((_, element) => element?.textContent === '3 / 3').length).toBeGreaterThan(0)
    expect(screen.getByTitle('Select / deselect all loaded alerts')).toBeInTheDocument()
    expect(screen.getByText('3 loaded alerts — select to bulk-triage')).toBeInTheDocument()

    const scrollContainer = container.querySelector('.alerts-list-scroll')
    expect(scrollContainer).not.toBeNull()
    expect(scrollContainer).toHaveStyle({ height: '258px', maxHeight: '640px' })

    await user.click(screen.getByRole('button', { name: /load more/i }))
    expect(mockState.fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('fails closed during replay and disables the infinite alert query', async () => {
    mockState.isReplaying = true
    renderAlertTriagePage()

    expect(await screen.findByText('Alert triage unavailable in replay')).toBeInTheDocument()
    expect(mockState.infiniteOptions).toMatchObject({ enabled: false, refetchInterval: false })
  })
})
