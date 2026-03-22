import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { getSignals } from '../api/signals'
import type { SignalsParams } from '../api/types'

interface UseSignalsOptions {
  refetchInterval?: number | false
}

export function useSignals(params?: SignalsParams, options?: UseSignalsOptions) {
  return useQuery({
    queryKey: ['signals', params],
    queryFn: () => getSignals(params),
    refetchInterval: options?.refetchInterval ?? 5000, // auto-refresh every 5s so the feed stays live
  })
}

const INFINITE_PER_PAGE = 75

// Infinite-scroll variant — used by SignalFeedPage for the virtual list.
// Fetches pages on demand as the user scrolls; each page is 75 rows.
// Filters (source, signal_type) are part of the query key so changing them
// resets to page 1 automatically.
export function useSignalsInfinite(params?: Omit<SignalsParams, 'page' | 'per_page'>) {
  return useInfiniteQuery({
    queryKey: ['signals', 'infinite', params],
    queryFn: ({ pageParam }) =>
      getSignals({ ...params, page: pageParam as number, per_page: INFINITE_PER_PAGE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const { page, total_pages } = lastPage.meta
      return page < total_pages ? page + 1 : undefined
    },
    refetchInterval: 30_000, // slower refetch for infinite — avoids layout thrash
  })
}
