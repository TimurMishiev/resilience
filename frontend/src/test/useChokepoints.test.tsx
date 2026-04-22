import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chokepoint, ChokepointsParams, PaginatedResponse } from '../api/types'
import { useAllChokepoints } from '../hooks/useChokepoints'

const getChokepointsMock = vi.fn<
  (params?: ChokepointsParams, options?: { signal?: AbortSignal }) => Promise<PaginatedResponse<Chokepoint>>
>()

vi.mock('../api/chokepoints', () => ({
  getChokepoints: (params?: ChokepointsParams, options?: { signal?: AbortSignal }) =>
    getChokepointsMock(params, options),
  createChokepoint: vi.fn(),
  updateChokepoint: vi.fn(),
  deleteChokepoint: vi.fn(),
}))

function makeChokepoint(id: string): Chokepoint {
  return {
    id,
    area_of_operation_id: 'ao-1',
    area_of_operation_name: 'AO One',
    name: `Chokepoint ${id}`,
    category: 'strait',
    status: 'monitor',
    latitude: 10,
    longitude: 20,
    watch_radius_km: 40,
    notes: null,
    created_by_id: 'user-1',
    updated_by_id: 'user-1',
    created_at: '2026-03-24T00:00:00Z',
    updated_at: '2026-03-24T00:00:00Z',
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
  getChokepointsMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useAllChokepoints', () => {
  it('fetches every chokepoint page for the main spatial surfaces data path', async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => makeChokepoint(`cp-${index + 1}`))
    const overflowPage = [makeChokepoint('cp-201')]

    getChokepointsMock
      .mockResolvedValueOnce({
        data: firstPage,
        meta: { total: 201, page: 1, per_page: 200, total_pages: 2 },
      })
      .mockResolvedValueOnce({
        data: overflowPage,
        meta: { total: 201, page: 2, per_page: 200, total_pages: 2 },
      })

    const { result } = renderHook(
      () => useAllChokepoints({ as_of: '2026-04-22T00:00:00.000Z' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.data).toHaveLength(201)
    expect(result.current.data?.data.at(-1)?.id).toBe('cp-201')
    expect(getChokepointsMock).toHaveBeenNthCalledWith(1, {
      as_of: '2026-04-22T00:00:00.000Z',
      page: 1,
      per_page: 200,
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(getChokepointsMock).toHaveBeenNthCalledWith(2, {
      as_of: '2026-04-22T00:00:00.000Z',
      page: 2,
      per_page: 200,
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })
})
