import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTelemetry } from '../hooks/useTelemetry'
import type { TelemetryReading } from '../lib/telemetry'

const getTelemetryMock = vi.fn()
const useTelemetryStreamMock = vi.fn()

vi.mock('../api/telemetry', () => ({
  getTelemetry: (...args: unknown[]) => getTelemetryMock(...args),
}))

vi.mock('../hooks/useTelemetryStream', () => ({
  useTelemetryStream: (...args: unknown[]) => useTelemetryStreamMock(...args),
}))

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

const readingA: TelemetryReading = {
  asset_id: 'asset-1',
  name: 'Asset One',
  lat: 10.5,
  lng: 20.5,
  heading: 45,
  speed: 12,
  battery: 88,
  ts: 1_711_000_000,
}

const readingB: TelemetryReading = {
  ...readingA,
  asset_id: 'asset-2',
  name: 'Asset Two',
  lat: 30.5,
  lng: 40.5,
}

beforeEach(() => {
  getTelemetryMock.mockReset()
  useTelemetryStreamMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useTelemetry', () => {
  it('returns replay telemetry snapshots as a reading map', async () => {
    useTelemetryStreamMock.mockReturnValue({ readings: new Map(), connected: false })
    getTelemetryMock.mockResolvedValue({
      data: [readingA, readingB],
      meta: { as_of: '2026-03-26T12:00:00.000Z', total: 2 },
    })

    const { result } = renderHook(
      () => useTelemetry(true, '2026-03-26T12:00:00.000Z'),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.connected).toBe(true))

    expect(Array.from(result.current.readings.keys())).toEqual(['asset-1', 'asset-2'])
    expect(result.current.readings.get('asset-2')).toMatchObject({ lng: 40.5 })
  })

  it('returns the live telemetry stream unchanged outside replay mode', () => {
    const liveReadings = new Map([['asset-1', readingA]])
    useTelemetryStreamMock.mockReturnValue({ readings: liveReadings, connected: true })

    const { result } = renderHook(
      () => useTelemetry(),
      { wrapper: createWrapper() },
    )

    expect(result.current.readings).toBe(liveReadings)
    expect(result.current.connected).toBe(true)
    expect(getTelemetryMock).not.toHaveBeenCalled()
  })
})
