import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  liveEnabled: {
    signals: [
      {
        id: 'sig-1',
        source: 'gdacs',
        signal_type: 'disaster_alert',
        external_id: 'gdacs-1',
        lat: 10,
        lng: 20,
        speed: null,
        magnitude: 3.2,
        altitude: null,
        occurred_at: '2026-03-24T00:00:00Z',
        raw_payload: {},
      },
    ],
    connected: false,
    isPending: false,
    error: null,
  },
  liveDisabled: {
    signals: [],
    connected: false,
    isPending: true,
    error: null,
  },
  infiniteEnabled: {
    data: {
      pages: [{ data: [], meta: { total: 0, page: 1, per_page: 75, total_pages: 0 } }],
    },
    error: null,
    isPending: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
  },
  infiniteDisabled: {
    data: undefined,
    error: null,
    isPending: true,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
  },
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * estimateSize(),
      })),
    getTotalSize: () => count * estimateSize(),
    measureElement: () => undefined,
  }),
}))

vi.mock('../hooks/useSignals', () => ({
  useSignalsLive: (options?: { enabled?: boolean }) =>
    options?.enabled === false ? mockState.liveDisabled : mockState.liveEnabled,
  useSignalsInfinite: (_params?: unknown, options?: { enabled?: boolean }) =>
    options?.enabled === false ? mockState.infiniteDisabled : mockState.infiniteEnabled,
}))

vi.mock('../hooks/useReferenceTimeMs', () => ({
  useReferenceTimeMs: () => Date.parse('2026-03-24T00:05:00Z'),
}))

vi.mock('../hooks/useReplayParams', () => ({
  useReplayParams: () => ({
    asOf: null,
    isReplaying: false,
    signalQueryParams: {},
  }),
}))

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({ isReplaying: false, asOf: null, start: vi.fn(), stop: vi.fn(), tick: vi.fn() }),
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => ({
    isCommander: false,
  }),
}))

vi.mock('../api/ai', () => ({
  getAiFilter: vi.fn(),
}))

vi.mock('../api/signals', async () => {
  const actual = await vi.importActual<typeof import('../api/signals')>('../api/signals')
  return {
    ...actual,
    injectSignal: vi.fn(),
  }
})

import SignalFeedPage from '../pages/SignalFeedPage'

function renderSignalFeedPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/signals']}>
        <SignalFeedPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SignalFeedPage', () => {
  it('renders live signal rows when snapshot data exists even if the disabled infinite query is pending', async () => {
    renderSignalFeedPage()

    expect(await screen.findByText('gdacs-1')).toBeInTheDocument()
    expect(screen.getAllByText('Disaster').length).toBeGreaterThan(0)
    expect(screen.queryByText('No signals yet')).not.toBeInTheDocument()
  })

  it('renders the empty state for a filtered zero-result feed without consulting the inactive live query state', async () => {
    const user = userEvent.setup()
    const { container } = renderSignalFeedPage()

    await user.selectOptions(screen.getAllByRole('combobox')[1], 'ais_gap')

    expect(await screen.findByText('No signals yet')).toBeInTheDocument()
    expect(container.querySelector('.signal-feed-table-wrap')).toBeNull()
  })
})
