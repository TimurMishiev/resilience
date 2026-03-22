import { useMutation, useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { getSignalRuleMatches, transitionAlert, bulkTransitionAlerts, getActiveBreachSiteIds } from '../api/signal_rule_matches'
import type { SignalRuleMatchesParams, TransitionAlertBody } from '../api/types'
import type { BulkTransitionBody } from '../api/signal_rule_matches'

export function useSignalRuleMatches(params?: SignalRuleMatchesParams) {
  return useQuery({
    queryKey: ['signal_rule_matches', params],
    queryFn: () => getSignalRuleMatches(params),
    refetchInterval: 10000, // refresh every 10s to catch new rule firings
  })
}

const INFINITE_PER_PAGE = 100

// Infinite-scroll variant for the Alert Triage page.
// Fetches 100 rows per page; changing filter params resets to page 1.
export function useSignalRuleMatchesInfinite(params?: Omit<SignalRuleMatchesParams, 'page' | 'per_page'>) {
  return useInfiniteQuery({
    queryKey: ['signal_rule_matches', 'infinite', params],
    queryFn: ({ pageParam }) =>
      getSignalRuleMatches({ ...params, page: pageParam as number, per_page: INFINITE_PER_PAGE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const { page, total_pages } = lastPage.meta
      return page < total_pages ? page + 1 : undefined
    },
    refetchInterval: 15_000, // slower than point query — avoids re-pagination thrash
  })
}

export function useTransitionAlert() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TransitionAlertBody }) =>
      transitionAlert(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signal_rule_matches'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

// Returns the set of site IDs with at least one unacknowledged geofence breach.
// Backed by an unpaginated backend query — never subject to page-cap omission.
export function useActiveBreachSiteIds() {
  return useQuery({
    queryKey: ['signal_rule_matches', 'active_breach_sites'],
    queryFn:  () => getActiveBreachSiteIds(),
    refetchInterval: 10_000,
  })
}

export function useBulkTransitionAlerts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: BulkTransitionBody) => bulkTransitionAlerts(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signal_rule_matches'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
