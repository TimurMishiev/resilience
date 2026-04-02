import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssetTrails } from '../hooks/useAssetTrails'

vi.mock('../api/telemetry', () => ({
  getTelemetry: vi.fn(),
  getAssetTrails: vi.fn().mockResolvedValue({
    data: [{
      asset_id: 'a1',
      name: 'Alpha-1',
      status: 'available',
      points: [
        { lat: 10.0, lng: 20.0, heading: 90, speed: 5, ts: 1000 },
        { lat: 10.1, lng: 20.1, heading: 91, speed: 6, ts: 1003 },
      ],
    }],
    meta: { as_of: '', from: '', window_minutes: 30, asset_count: 1 },
  }),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe('useAssetTrails', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns empty array when asOf is null (live mode)', () => {
    const { result } = renderHook(() => useAssetTrails(null), { wrapper: createWrapper() })
    expect(result.current).toEqual([])
  })

  it('returns empty array when asOf is undefined', () => {
    const { result } = renderHook(() => useAssetTrails(undefined), { wrapper: createWrapper() })
    expect(result.current).toEqual([])
  })

  it('fetches trails when asOf is provided (replay mode)', async () => {
    const { result } = renderHook(() => useAssetTrails('2026-03-30T12:00:00Z'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.length).toBe(1))
    expect(result.current[0].asset_id).toBe('a1')
    expect(result.current[0].points).toHaveLength(2)
  })

  it('passes window_minutes to getAssetTrails when provided', async () => {
    const { getAssetTrails } = await import('../api/telemetry')
    renderHook(() => useAssetTrails('2026-03-30T12:00:00Z', 60), { wrapper: createWrapper() })
    await waitFor(() => expect(getAssetTrails).toHaveBeenCalledWith(
      expect.objectContaining({ as_of: '2026-03-30T12:00:00Z', window_minutes: 60 })
    ))
  })

  it('omits window_minutes when not provided', async () => {
    const { getAssetTrails } = await import('../api/telemetry')
    renderHook(() => useAssetTrails('2026-03-30T12:00:00Z'), { wrapper: createWrapper() })
    await waitFor(() => expect(getAssetTrails).toHaveBeenCalledWith(
      expect.objectContaining({ as_of: '2026-03-30T12:00:00Z' })
    ))
    const call = (getAssetTrails as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call).not.toHaveProperty('window_minutes')
  })
})
