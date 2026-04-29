import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSignalStream } from '../hooks/useSignalStream'
import { MockEventSource } from './helpers/MockEventSource'

const postMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    post: (...args: unknown[]) => postMock(...args),
  },
}))

describe('useSignalStream', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    postMock.mockReset()
    postMock.mockResolvedValue({ token: 'signal-token', expires_in: 60 })
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('connects and tracks signal events', async () => {
    const { result } = renderHook(() => useSignalStream(true))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const es = MockEventSource.instances[0]
    act(() => es.emit('connected'))
    expect(result.current.connected).toBe(true)

    act(() =>
      es.emit('signal', {
        id: 'sig-1',
        source: 'usgs_seismic',
        signal_type: 'seismic_event',
        lat: 36.0,
        lng: -5.0,
        occurred_at: '2026-04-01T09:55:00.000Z',
        ingested_at: '2026-04-01T09:55:01.000Z',
      }),
    )

    expect(result.current.signals).toHaveLength(1)
    expect(result.current.signals[0].id).toBe('sig-1')
    expect(result.current.signalsById.has('sig-1')).toBe(true)
  })

  it('does not connect when disabled', async () => {
    const { result } = renderHook(() => useSignalStream(false))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(MockEventSource.instances).toHaveLength(0)
    expect(result.current.connected).toBe(false)
    expect(result.current.signals).toHaveLength(0)
  })

  it('clears signals when disabled', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useSignalStream(enabled),
      { initialProps: { enabled: true } },
    )

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const es = MockEventSource.instances[0]
    act(() => es.emit('connected'))
    act(() =>
      es.emit('signal', {
        id: 'sig-1',
        source: 'usgs_seismic',
        signal_type: 'seismic_event',
        lat: 36.0,
        lng: -5.0,
        occurred_at: '2026-04-01T09:55:00.000Z',
        ingested_at: '2026-04-01T09:55:01.000Z',
      }),
    )

    expect(result.current.signals).toHaveLength(1)

    rerender({ enabled: false })
    expect(result.current.signals).toHaveLength(0)
    expect(result.current.connected).toBe(false)
  })

  it('reconnects on error with back-off', async () => {
    renderHook(() => useSignalStream(true))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const es1 = MockEventSource.instances[0]
    act(() => es1.emit('connected'))

    // Trigger disconnect
    act(() => es1.triggerError())
    expect(es1.closed).toBe(true)

    // Failed stream opens now wait 5s before retrying so reconnect storms do
    // not trip the shared stream-open throttle bucket.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(MockEventSource.instances).toHaveLength(2)
  })

  it('ignores malformed signal payloads', async () => {
    const { result } = renderHook(() => useSignalStream(true))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const es = MockEventSource.instances[0]
    act(() => es.emit('connected'))

    // Emit a bad payload directly
    const signalListener = es.listeners.get('signal')?.[0]
    expect(() => {
      signalListener?.({ data: 'not-json' } as unknown as Event)
    }).not.toThrow()

    expect(result.current.signals).toHaveLength(0)
  })

  it('includes since parameter when seedCursor is provided', async () => {
    renderHook(() =>
      useSignalStream(true, { seedCursor: '2026-04-01T09:00:00.000Z' }),
    )

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const es = MockEventSource.instances[0]
    expect(es.url).toContain('since=')
    expect(es.url).toContain('2026-04-01')
  })

  it('closes EventSource and clears timeout on unmount', async () => {
    const { unmount } = renderHook(() => useSignalStream(true))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const es = MockEventSource.instances[0]
    expect(es.closed).toBe(false)

    unmount()
    expect(es.closed).toBe(true)
  })
})
