import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSourceHealth } from '../hooks/useSourceHealth'

// Freeze the freshness clock so tests are deterministic
vi.useFakeTimers()

describe('useSourceHealth', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-04-10T12:00:00Z'))
  })

  it('returns fresh aggregate when SSE is connected and data is recent', () => {
    const now = Date.now()
    const { result } = renderHook(() => useSourceHealth('connected', now))

    expect(result.current.sse).toBe('fresh')
    expect(result.current.data).toBe('fresh')
    expect(result.current.aggregate).toBe('fresh')
  })

  it('returns aging aggregate when SSE is connecting', () => {
    const now = Date.now()
    const { result } = renderHook(() => useSourceHealth('connecting', now))

    expect(result.current.sse).toBe('aging')
    expect(result.current.data).toBe('fresh')
    expect(result.current.aggregate).toBe('aging')
  })

  it('returns stale aggregate when SSE is disconnected', () => {
    const now = Date.now()
    const { result } = renderHook(() => useSourceHealth('disconnected', now))

    expect(result.current.sse).toBe('stale')
    expect(result.current.data).toBe('fresh')
    expect(result.current.aggregate).toBe('stale')
  })

  it('returns stale aggregate when data is old', () => {
    const now = Date.now()
    const oldData = now - 200_000 // well past the 120s stale threshold
    const { result } = renderHook(() => useSourceHealth('connected', oldData))

    expect(result.current.sse).toBe('fresh')
    expect(result.current.data).toBe('stale')
    expect(result.current.aggregate).toBe('stale')
  })

  it('returns unavailable data freshness when dataUpdatedAt is 0', () => {
    const { result } = renderHook(() => useSourceHealth('connected', 0))

    expect(result.current.data).toBe('unavailable')
    expect(result.current.aggregate).toBe('unavailable')
  })

  it('returns aging data freshness when data is between thresholds', () => {
    const now = Date.now()
    const agingData = now - 60_000 // 60s — past 30s aging, before 120s stale
    const { result } = renderHook(() => useSourceHealth('connected', agingData))

    expect(result.current.data).toBe('aging')
    expect(result.current.aggregate).toBe('aging')
  })
})
