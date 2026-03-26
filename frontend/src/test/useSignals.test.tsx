import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaginatedResponse, Signal, SignalType, SignalsParams } from '../api/types'
import { LIVE_SIGNAL_TYPES } from '../lib/liveSignals'
import { useSignalsInfinite, useSignalsLive } from '../hooks/useSignals'

const getSignalsMock = vi.fn<(params?: SignalsParams) => Promise<PaginatedResponse<Signal>>>()
const useSignalStreamMock = vi.fn()

vi.mock('../api/signals', () => ({
  getSignals: (params?: SignalsParams) => getSignalsMock(params),
}))

vi.mock('../hooks/useSignalStream', () => ({
  useSignalStream: (...args: unknown[]) => useSignalStreamMock(...args),
}))

function makeSignal(
  id: string,
  signalType: SignalType,
  occurredAt: string,
  ingestedAt = occurredAt,
): Signal {
  return {
    id,
    source: 'manual',
    signal_type: signalType,
    external_id: id,
    lat: '10',
    lng: '20',
    altitude: null,
    speed: null,
    heading: null,
    magnitude: null,
    raw_payload: {},
    occurred_at: occurredAt,
    ingested_at: ingestedAt,
  }
}

function makePage(signals: Signal[]): PaginatedResponse<Signal> {
  return {
    data: signals,
    meta: {
      total: signals.length,
      page: 1,
      per_page: signals.length || 50,
      total_pages: 1,
    },
  }
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )
  }
}

beforeEach(() => {
  getSignalsMock.mockReset()
  useSignalStreamMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useSignals hooks', () => {
  it('returns replay snapshots sorted newest-first', async () => {
    const newest = makeSignal('sig-new', 'manual', '2026-03-26T12:00:00.000Z')
    const oldest = makeSignal('sig-old', 'gps_jamming', '2026-03-26T10:00:00.000Z')

    useSignalStreamMock.mockReturnValue({
      signals: [],
      connected: false,
      connectionId: 0,
      signalsById: new Map(),
    })
    getSignalsMock.mockImplementation(async params => {
      if (params?.signal_type === 'manual') return makePage([newest])
      if (params?.signal_type === 'gps_jamming') return makePage([oldest])
      return makePage([])
    })

    const { result } = renderHook(
      () => useSignalsLive({ asOf: '2026-03-26T12:30:00.000Z' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.connected).toBe(true))

    expect(result.current.signals.map(signal => signal.id)).toEqual([
      'sig-new',
      'sig-old',
    ])
    expect(getSignalsMock).toHaveBeenCalledWith(expect.objectContaining({
      as_of: '2026-03-26T12:30:00.000Z',
      signal_type: 'manual',
    }))
  })

  it('merges live stream signals with snapshot baseline after baseline sync completes', async () => {
    const snapshotSignal = makeSignal('sig-snapshot', 'manual', '2026-03-26T11:00:00.000Z', '2026-03-26T11:00:00.000Z')
    const liveSignal = makeSignal('sig-live', 'gps_jamming', '2026-03-26T12:30:00.000Z', '2026-03-26T12:31:00.000Z')

    useSignalStreamMock.mockReturnValue({
      signals: [liveSignal],
      connected: true,
      connectionId: 7,
      signalsById: new Map([[liveSignal.id, liveSignal]]),
    })
    getSignalsMock.mockImplementation(async params => {
      if (params?.signal_type === 'manual') return makePage([snapshotSignal])
      return makePage([])
    })

    const { result } = renderHook(
      () => useSignalsLive(),
      { wrapper: createWrapper() },
    )

    expect(result.current.signals).toEqual([])
    expect(result.current.connected).toBe(false)

    await waitFor(() => expect(result.current.connected).toBe(true))

    expect(result.current.signals.map(signal => signal.id)).toEqual([
      'sig-live',
      'sig-snapshot',
    ])
  })

  it('surfaces baseline errors before live sync is considered connected', async () => {
    useSignalStreamMock.mockReturnValue({
      signals: [],
      connected: true,
      connectionId: 1,
      signalsById: new Map(),
    })
    getSignalsMock.mockImplementation(async params => {
      if (params?.signal_type === LIVE_SIGNAL_TYPES[0]) throw new Error('snapshot failed')
      return makePage([])
    })

    const { result } = renderHook(
      () => useSignalsLive(),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))

    expect(result.current.connected).toBe(false)
    expect(result.current.signals).toEqual([])
    expect((result.current.error as Error).message).toMatch(/snapshot failed/i)
  })

  it('keeps the infinite query inert when disabled', () => {
    useSignalStreamMock.mockReturnValue({
      signals: [],
      connected: false,
      connectionId: 0,
      signalsById: new Map(),
    })

    const { result } = renderHook(
      () => useSignalsInfinite(undefined, { enabled: false }),
      { wrapper: createWrapper() },
    )

    expect(result.current.isPending).toBe(false)
    expect(result.current.isFetchingNextPage).toBe(false)
    expect(result.current.hasNextPage).toBe(false)
    expect(getSignalsMock).not.toHaveBeenCalled()
  })
})
