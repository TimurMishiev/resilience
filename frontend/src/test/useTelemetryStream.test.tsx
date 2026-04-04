import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTelemetryStream } from '../hooks/useTelemetryStream'
import { MockEventSource } from './helpers/MockEventSource'

const postMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    post: (...args: unknown[]) => postMock(...args),
  },
}))

describe('useTelemetryStream', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    postMock.mockReset()
    postMock.mockResolvedValue({ token: 'telemetry-token', expires_in: 60 })
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('connects and receives telemetry readings', async () => {
    const { result } = renderHook(() => useTelemetryStream(true))

    // Advance just enough to flush the microtask queue (token exchange)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const es = MockEventSource.instances[0]
    act(() => es.emit('connected'))
    expect(result.current.connected).toBe(true)

    act(() =>
      es.emit('telemetry', {
        asset_id: 'asset-1',
        name: 'Patrol Vessel Alpha',
        lat: 36.1,
        lng: -5.2,
        heading: 180,
        speed: 4.5,
        battery: 85,
        ts: Math.floor(Date.now() / 1000),
      }),
    )

    expect(result.current.readings.size).toBe(1)
    expect(result.current.readings.get('asset-1')).toBeDefined()
    expect(result.current.readings.get('asset-1')!.lat).toBe(36.1)
  })

  it('updates existing reading for the same asset', async () => {
    const { result } = renderHook(() => useTelemetryStream(true))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const es = MockEventSource.instances[0]
    act(() => es.emit('connected'))

    const ts = Math.floor(Date.now() / 1000)

    act(() =>
      es.emit('telemetry', {
        asset_id: 'asset-1',
        name: 'Alpha',
        lat: 36.0,
        lng: -5.0,
        heading: 90,
        speed: 3.0,
        battery: 90,
        ts,
      }),
    )

    act(() =>
      es.emit('telemetry', {
        asset_id: 'asset-1',
        name: 'Alpha',
        lat: 36.1,
        lng: -5.1,
        heading: 95,
        speed: 3.5,
        battery: 88,
        ts: ts + 3,
      }),
    )

    expect(result.current.readings.size).toBe(1)
    expect(result.current.readings.get('asset-1')!.lat).toBe(36.1)
  })

  it('does not connect when disabled', async () => {
    const { result } = renderHook(() => useTelemetryStream(false))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(MockEventSource.instances).toHaveLength(0)
    expect(result.current.connected).toBe(false)
    expect(result.current.readings.size).toBe(0)
  })

  it('clears readings when disabled', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useTelemetryStream(enabled),
      { initialProps: { enabled: true } },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const es = MockEventSource.instances[0]
    act(() => es.emit('connected'))
    act(() =>
      es.emit('telemetry', {
        asset_id: 'asset-1',
        name: 'Alpha',
        lat: 36.0,
        lng: -5.0,
        heading: 90,
        speed: 3.0,
        battery: 90,
        ts: Math.floor(Date.now() / 1000),
      }),
    )

    expect(result.current.readings.size).toBe(1)

    rerender({ enabled: false })
    expect(result.current.readings.size).toBe(0)
    expect(result.current.connected).toBe(false)
  })

  it('reconnects on error', async () => {
    renderHook(() => useTelemetryStream(true))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const es1 = MockEventSource.instances[0]
    act(() => es1.emit('connected'))
    act(() => es1.triggerError())

    expect(es1.closed).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(MockEventSource.instances).toHaveLength(2)
  })

  it('retries when token exchange fails', async () => {
    postMock.mockRejectedValueOnce(new Error('Token fetch failed'))

    renderHook(() => useTelemetryStream(true))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(MockEventSource.instances).toHaveLength(0)

    postMock.mockResolvedValueOnce({ token: 'retry-token', expires_in: 60 })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(MockEventSource.instances).toHaveLength(1)
  })

  it('ignores malformed telemetry data', async () => {
    const { result } = renderHook(() => useTelemetryStream(true))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const es = MockEventSource.instances[0]
    act(() => es.emit('connected'))

    const telemetryListener = es.listeners.get('telemetry')?.[0]
    expect(() => {
      telemetryListener?.({ data: '{bad json' } as unknown as Event)
    }).not.toThrow()

    expect(result.current.readings.size).toBe(0)
  })

  it('closes EventSource on unmount', async () => {
    const { unmount } = renderHook(() => useTelemetryStream(true))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const es = MockEventSource.instances[0]
    unmount()
    expect(es.closed).toBe(true)
  })

  it('includes token in stream URL', async () => {
    postMock.mockResolvedValue({ token: 'my-telem-token', expires_in: 60 })

    renderHook(() => useTelemetryStream(true))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(MockEventSource.instances[0].url).toBe(
      '/api/telemetry/stream?token=my-telem-token',
    )
  })
})
