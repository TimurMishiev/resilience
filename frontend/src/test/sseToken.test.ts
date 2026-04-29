import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSseToken, __resetSseTokenCacheForTests } from '../lib/sseToken'

// Audit P3 (2026-04-29): the previous design had three stream hooks
// (useEventSource, useSignalStream, useTelemetryStream) each calling
// `POST /api/sse_token` independently during reconnect. Concurrent
// reconnects could mint multiple tokens; the second would supersede
// the first, wasting the rate-limit bucket and adding back-off latency.
//
// fetchSseToken wraps the call in a shared in-flight promise so
// simultaneous callers reuse the same fetch and the same returned
// token. After the promise settles the cache clears, so the NEXT
// caller starts a fresh request — which is correct, because tokens
// are short-lived (60s) and intentionally per-connection.

vi.mock('../api/client', () => ({
  api: { post: vi.fn() },
}))

import { api } from '../api/client'

describe('fetchSseToken', () => {
  afterEach(() => {
    __resetSseTokenCacheForTests()
    vi.clearAllMocks()
  })

  it('coalesces concurrent callers into a single in-flight request', async () => {
    let resolveToken: (v: { token: string; expires_in: number }) => void = () => {}
    const pending = new Promise<{ token: string; expires_in: number }>((resolve) => {
      resolveToken = resolve
    })
    ;(api.post as ReturnType<typeof vi.fn>).mockReturnValueOnce(pending)

    // Three callers fire before the request settles. They MUST all
    // await the same in-flight promise — only one POST should fly.
    const callers = [fetchSseToken(), fetchSseToken(), fetchSseToken()]

    expect((api.post as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)

    resolveToken({ token: 'abc', expires_in: 60 })
    const results = await Promise.all(callers)
    expect(results.every((r) => r.token === 'abc')).toBe(true)
    // Still exactly one POST after settlement.
    expect((api.post as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })

  it('starts a fresh request after the in-flight promise settles', async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      token: 't1', expires_in: 60,
    })
    const r1 = await fetchSseToken()
    expect(r1.token).toBe('t1')

    // Second call AFTER the first settled — must trigger a new request.
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      token: 't2', expires_in: 60,
    })
    const r2 = await fetchSseToken()
    expect(r2.token).toBe('t2')

    expect((api.post as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
  })

  it('clears the cache on rejection so the next caller can retry', async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'))

    await expect(fetchSseToken()).rejects.toThrow('network')

    // After rejection, the cache must be cleared. A retry should
    // hit api.post again rather than reusing the failed promise.
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      token: 'recovered', expires_in: 60,
    })
    const retry = await fetchSseToken()
    expect(retry.token).toBe('recovered')
    expect((api.post as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
  })
})
