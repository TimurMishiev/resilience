import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEventSource } from '../hooks/useEventSource'
import { MockEventSource } from './helpers/MockEventSource'

const postMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    post: (...args: unknown[]) => postMock(...args),
  },
}))

describe('useEventSource lifecycle', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    postMock.mockReset()
    postMock.mockResolvedValue({ token: 'test-token', expires_in: 60 })
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('starts as disconnected, transitions to connecting, then connected', async () => {
    const { result } = renderHook(() => useEventSource({ enabled: true }))

    expect(result.current.status).toBe('connecting')

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const es = MockEventSource.instances[0]
    act(() => es.emit('connected'))

    expect(result.current.status).toBe('connected')
  })

  it('does not connect when disabled', async () => {
    renderHook(() => useEventSource({ enabled: false }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(MockEventSource.instances).toHaveLength(0)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('transitions to disconnected on error and retries with exponential back-off', async () => {
    const { result } = renderHook(() => useEventSource({ enabled: true }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const es1 = MockEventSource.instances[0]
    act(() => es1.emit('connected'))
    expect(result.current.status).toBe('connected')

    // Trigger error
    act(() => es1.triggerError())
    expect(result.current.status).toBe('disconnected')
    expect(es1.closed).toBe(true)

    // After 1s, should retry
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(MockEventSource.instances).toHaveLength(2)
  })

  it('resets back-off delay after successful reconnection', async () => {
    const { result } = renderHook(() => useEventSource({ enabled: true }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    // First connection succeeds
    const es1 = MockEventSource.instances[0]
    act(() => es1.emit('connected'))

    // Error triggers retry
    act(() => es1.triggerError())

    // Wait for first retry (1s delay)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    const es2 = MockEventSource.instances[1]
    // Second connection succeeds — should reset delay
    act(() => es2.emit('connected'))
    expect(result.current.status).toBe('connected')

    // Another error
    act(() => es2.triggerError())

    // Should retry at 1s again (delay was reset), not 2s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(MockEventSource.instances).toHaveLength(3)
  })

  it('closes EventSource on unmount', async () => {
    const { unmount } = renderHook(() => useEventSource({ enabled: true }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const es = MockEventSource.instances[0]
    expect(es.closed).toBe(false)

    unmount()
    expect(es.closed).toBe(true)
  })

  it('fires onEvent callback for live event types', async () => {
    const onEvent = vi.fn()
    renderHook(() => useEventSource({ onEvent, enabled: true }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const es = MockEventSource.instances[0]
    act(() => es.emit('connected'))
    act(() => es.emit('task_created', { id: 'task-1', title: 'New patrol' }))

    expect(onEvent).toHaveBeenCalledWith({
      event: 'task_created',
      data: { id: 'task-1', title: 'New patrol' },
    })
  })

  it('handles malformed JSON in event data without crashing', async () => {
    const onEvent = vi.fn()
    renderHook(() => useEventSource({ onEvent, enabled: true }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const es = MockEventSource.instances[0]
    act(() => es.emit('connected'))

    // Manually emit with invalid JSON
    const badListener = es.listeners.get('task_created')?.[0]
    expect(() => {
      badListener?.({ data: 'not-valid-json{' } as unknown as Event)
    }).not.toThrow()

    // Should not have called onEvent with bad data
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('retries when token exchange fails', async () => {
    postMock.mockRejectedValueOnce(new Error('Network error'))

    renderHook(() => useEventSource({ enabled: true }))

    // Flush the rejected promise
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // No EventSource created since token fetch failed
    expect(MockEventSource.instances).toHaveLength(0)

    // Resolve token on retry
    postMock.mockResolvedValueOnce({ token: 'retry-token', expires_in: 60 })

    // Advance past back-off delay (1s initial)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toContain('retry-token')
  })

  it('includes SSE token in EventSource URL', async () => {
    postMock.mockResolvedValue({ token: 'my-sse-token', expires_in: 60 })

    renderHook(() => useEventSource({ enabled: true }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(MockEventSource.instances[0].url).toBe('/api/events?token=my-sse-token')
  })
})
