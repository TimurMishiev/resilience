import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bucketReplayAsOf, useActiveSiteConfidence } from '../hooks/useActiveSiteConfidence'

vi.mock('../api/signal_rule_matches', () => ({
  getActiveSiteConfidence: vi.fn().mockResolvedValue({
    summaries: [
      { site_id: 'site-a', confidence: 0.85 },
      { site_id: 'site-b', confidence: 0.42 },
    ],
  }),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

// One shared client across multiple renderHook calls so cache hits
// between close `as_of` values can actually be observed.
function createSharedWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe('bucketReplayAsOf', () => {
  it('rounds an ISO timestamp down to the bucket floor', () => {
    expect(bucketReplayAsOf('2026-04-20T12:00:03.250Z', 5_000))
      .toBe('2026-04-20T12:00:00.000Z')
  })

  it('preserves a timestamp that already sits on a bucket boundary', () => {
    expect(bucketReplayAsOf('2026-04-20T12:00:05.000Z', 5_000))
      .toBe('2026-04-20T12:00:05.000Z')
  })

  it('passes through unparseable input unchanged (no silent corruption)', () => {
    expect(bucketReplayAsOf('not-a-timestamp', 5_000)).toBe('not-a-timestamp')
  })
})

describe('useActiveSiteConfidence', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns the raw backend summaries unchanged (no surface-specific filtering)', async () => {
    const { result } = renderHook(() => useActiveSiteConfidence(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.summaries).toEqual([
      { site_id: 'site-a', confidence: 0.85 },
      { site_id: 'site-b', confidence: 0.42 },
    ])
  })

  it('rounds as_of down to the 5s replay-cache bucket before sending it to the API client', async () => {
    const { getActiveSiteConfidence } = await import('../api/signal_rule_matches')
    // 12:00:03.250Z falls inside the 12:00:00.000–12:00:05.000 bucket; the
    // wire request must use the bucket floor so that cache keys collapse.
    renderHook(
      () => useActiveSiteConfidence({ as_of: '2026-04-20T12:00:03.250Z' }),
      { wrapper: createWrapper() },
    )
    await waitFor(() =>
      expect(getActiveSiteConfidence).toHaveBeenCalledWith({ as_of: '2026-04-20T12:00:00.000Z' }),
    )
  })

  it('does not refetch as the replay cursor advances within the same 5s bucket (P2 fix — no per-tick refetch)', async () => {
    const { getActiveSiteConfidence } = await import('../api/signal_rule_matches')
    const wrapper = createSharedWrapper()

    // Production scenario: MapPage stays mounted as `as_of` advances. We
    // assert across rerenders, not across remounts (which would refetch
    // under react-query's default staleTime: 0).
    const { result, rerender } = renderHook(
      (props: { as_of: string }) => useActiveSiteConfidence(props),
      {
        wrapper,
        initialProps: { as_of: '2026-04-20T12:00:00.500Z' },
      },
    )
    await waitFor(() => expect(result.current.data).toBeDefined())

    // Two more cursor positions inside the 12:00:00.000–12:00:04.999 bucket.
    rerender({ as_of: '2026-04-20T12:00:02.000Z' })
    rerender({ as_of: '2026-04-20T12:00:04.999Z' })

    // Give react-query a tick in case any refetch were going to fire.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getActiveSiteConfidence).toHaveBeenCalledTimes(1)
  })

  it('refetches when the replay cursor crosses a bucket boundary', async () => {
    const { getActiveSiteConfidence } = await import('../api/signal_rule_matches')
    const wrapper = createSharedWrapper()

    const { result, rerender } = renderHook(
      (props: { as_of: string }) => useActiveSiteConfidence(props),
      {
        wrapper,
        initialProps: { as_of: '2026-04-20T12:00:04.999Z' },
      },
    )
    await waitFor(() => expect(result.current.data).toBeDefined())

    // Crossing into the 12:00:05.000–12:00:09.999 bucket → distinct key.
    rerender({ as_of: '2026-04-20T12:00:05.001Z' })
    await waitFor(() => expect(getActiveSiteConfidence).toHaveBeenCalledTimes(2))
  })

  it('does not fire the query when enabled=false (live-mode no-op contract)', async () => {
    const { getActiveSiteConfidence } = await import('../api/signal_rule_matches')
    renderHook(
      () => useActiveSiteConfidence(undefined, { enabled: false }),
      { wrapper: createWrapper() },
    )
    // Give react-query a tick to attempt the fetch if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getActiveSiteConfidence).not.toHaveBeenCalled()
  })

  it('honors a custom refetchInterval', async () => {
    const { result } = renderHook(
      () => useActiveSiteConfidence(undefined, { refetchInterval: 30_000 }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(result.current.data).toBeDefined())
    // Smoke: data resolved with the override; the query did not error out.
    expect(result.current.error).toBeNull()
  })
})
