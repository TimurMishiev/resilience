import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedHealthEntry, OperationalStatusEntry } from '../api/operational_health'

const mockState = vi.hoisted(() => ({
  feeds: [] as FeedHealthEntry[],
  feedPending: false,
  feedError: null as Error | null,
  opsEntries: [] as OperationalStatusEntry[],
  opsPending: false,
  opsError: null as Error | null,
}))

vi.mock('../hooks/useOperationalHealth', () => ({
  useFeedHealth: () => ({
    data: { data: mockState.feeds },
    isPending: mockState.feedPending,
    error: mockState.feedError,
  }),
  useOperationalHealth: () => ({
    data: { data: mockState.opsEntries },
    isPending: mockState.opsPending,
    error: mockState.opsError,
    dataUpdatedAt: Date.now(),
  }),
}))

async function renderPage() {
  const { default: OperationalHealthPage } = await import('../pages/OperationalHealthPage')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OperationalHealthPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('OperationalHealthPage', () => {
  beforeEach(() => {
    mockState.feeds = []
    mockState.feedPending = false
    mockState.feedError = null
    mockState.opsEntries = []
    mockState.opsPending = false
    mockState.opsError = null
  })

  it('renders empty state when no data is recorded', async () => {
    await renderPage()

    expect(screen.getByText('Operational Health')).toBeInTheDocument()
    expect(screen.getByText('No feed health data recorded yet.')).toBeInTheDocument()
    expect(screen.getByText('No relay health data recorded yet.')).toBeInTheDocument()
  })

  it('renders feed health table with data', async () => {
    mockState.feeds = [
      {
        feed: 'acled',
        status: 'ok',
        started_at: '2026-04-03T01:00:00.000Z',
        finished_at: '2026-04-03T01:00:01.000Z',
        duration_ms: 1000,
        fetched_count: 12,
        ingested_count: 3,
        duplicate_count: 2,
        skipped_count: 1,
        error_count: 0,
        page_count: 2,
        query_box_count: 3,
      },
      {
        feed: 'ais',
        status: 'disabled',
        started_at: '2026-04-03T01:00:00.000Z',
        finished_at: '2026-04-03T01:00:00.500Z',
        duration_ms: 500,
        fetched_count: 0,
        ingested_count: 0,
        duplicate_count: 0,
        skipped_count: 0,
        error_count: 1,
        page_count: 0,
        query_box_count: 0,
        error_messages: ['AISHUB_USERNAME not configured'],
      },
    ]

    await renderPage()

    expect(screen.getByText('acled')).toBeInTheDocument()
    expect(screen.getByText('OK')).toBeInTheDocument()
    expect(screen.getByText('ais')).toBeInTheDocument()
    expect(screen.getByText('DISABLED')).toBeInTheDocument()
    // Error messages callout
    expect(screen.getByText('AISHUB_USERNAME not configured')).toBeInTheDocument()
  })

  it('renders relay health with stale detection', async () => {
    const pastExpiry = new Date(Date.now() - 120_000).toISOString()

    mockState.opsEntries = [
      {
        category: 'relay_health',
        key: 'main:signals',
        payload: {
          status: 'ok',
          relay: 'main',
          channel: 'signals',
          last_seen_at: pastExpiry,
          heartbeat_expires_at: pastExpiry,
        },
        updated_at: pastExpiry,
      },
    ]

    await renderPage()

    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('signals')).toBeInTheDocument()
    expect(screen.getByText('STALE')).toBeInTheDocument()
  })

  it('renders relay as OK when heartbeat has not expired', async () => {
    const futureExpiry = new Date(Date.now() + 60_000).toISOString()

    mockState.opsEntries = [
      {
        category: 'relay_health',
        key: 'main:telemetry',
        payload: {
          status: 'ok',
          relay: 'main',
          channel: 'telemetry',
          last_seen_at: new Date().toISOString(),
          heartbeat_expires_at: futureExpiry,
        },
        updated_at: new Date().toISOString(),
      },
    ]

    await renderPage()

    expect(screen.getByText('OK')).toBeInTheDocument()
    expect(screen.queryByText('STALE')).not.toBeInTheDocument()
  })

  it('shows error callouts when API requests fail', async () => {
    mockState.feedError = new Error('Feed health unavailable')
    mockState.opsError = new Error('Operational health unavailable')

    await renderPage()

    expect(screen.getByText('Feed health unavailable')).toBeInTheDocument()
    expect(screen.getByText('Operational health unavailable')).toBeInTheDocument()
  })

  it('shows skeleton loading state', async () => {
    mockState.feedPending = true
    mockState.opsPending = true

    const { container } = await renderPage()

    const skeletons = container.querySelectorAll(`.${CSS.escape('bp6-skeleton')}`)
    expect(skeletons.length).toBeGreaterThanOrEqual(4) // KPI skeletons + table skeletons
  })
})
