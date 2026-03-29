import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEventSource } from '../hooks/useEventSource'

const postMock = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    post: (...args: unknown[]) => postMock(...args),
  },
}))

class MockEventSource {
  static instances: MockEventSource[] = []

  public readonly url: string
  public readonly listeners = new Map<string, EventListener[]>()
  public onerror: ((this: EventSource, ev: Event) => unknown) | null = null

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = typeof listener === 'function'
      ? listener
      : (event: Event) => listener.handleEvent(event)
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback])
  }

  close() {}
}

describe('useEventSource', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    postMock.mockReset()
    postMock.mockResolvedValue({ token: 'test-token', expires_in: 60 })
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('subscribes to planning, chokepoint, and site-risk SSE events', async () => {
    renderHook(() => useEventSource({ enabled: true }))

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    const source = MockEventSource.instances[0]
    expect(Array.from(source.listeners.keys())).toEqual(expect.arrayContaining([
      'planning_doctrine_updated',
      'chokepoint_updated',
      'site_risk_updated',
      'task_updated',
    ]))
  })
})
