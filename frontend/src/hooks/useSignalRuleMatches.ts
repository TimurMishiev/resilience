import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useReplayGuardedMutation } from './useReplayGuardedMutation'
import { getSignalRuleMatches, transitionAlert, bulkTransitionAlerts, getActiveBreachSiteIds } from '../api/signal_rule_matches'
import type { AsOfParam, SignalRuleMatchesParams, TransitionAlertBody } from '../api/types'
import type { BulkTransitionBody } from '../api/signal_rule_matches'

interface MatchQueryOptions {
  enabled?: boolean
  refetchInterval?: number | false
}

export function useSignalRuleMatches(params?: SignalRuleMatchesParams, options?: MatchQueryOptions) {
  return useQuery({
    queryKey: ['signal_rule_matches', params],
    queryFn: () => getSignalRuleMatches(params),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 10000, // refresh every 10s to catch new rule firings
  })
}

const INFINITE_PER_PAGE = 100

// Infinite-scroll variant for the Alert Triage page.
// Fetches 100 rows per page; changing filter params resets to page 1.
export function useSignalRuleMatchesInfinite(
  params?: Omit<SignalRuleMatchesParams, 'page' | 'per_page'>,
  options?: MatchQueryOptions,
) {
  return useInfiniteQuery({
    queryKey: ['signal_rule_matches', 'infinite', params],
    queryFn: ({ pageParam }) =>
      getSignalRuleMatches({ ...params, page: pageParam as number, per_page: INFINITE_PER_PAGE }),
    initialPageParam: 1,
    enabled: options?.enabled ?? true,
    getNextPageParam: (lastPage) => {
      const { page, total_pages } = lastPage.meta
      return page < total_pages ? page + 1 : undefined
    },
    refetchInterval: options?.refetchInterval ?? 15_000, // slower than point query — avoids re-pagination thrash
  })
}

export function useTransitionAlert() {
  const queryClient = useQueryClient()
  return useReplayGuardedMutation({
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
export function useActiveBreachSiteIds(params?: AsOfParam, options?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery({
    queryKey: ['signal_rule_matches', 'active_breach_sites', params],
    queryFn:  () => getActiveBreachSiteIds(params),
    refetchInterval: options?.refetchInterval ?? 10_000,
    enabled: options?.enabled ?? true,
  })
}

export function useBulkTransitionAlerts() {
  const queryClient = useQueryClient()
  return useReplayGuardedMutation({
    mutationFn: (body: BulkTransitionBody) => bulkTransitionAlerts(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signal_rule_matches'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
