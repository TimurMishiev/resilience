import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSignalRuleMatches, transitionAlert, bulkTransitionAlerts } from '../api/signal_rule_matches'
import type { SignalRuleMatchesParams, TransitionAlertBody } from '../api/types'
import type { BulkTransitionBody } from '../api/signal_rule_matches'

export function useSignalRuleMatches(params?: SignalRuleMatchesParams) {
  return useQuery({
    queryKey: ['signal_rule_matches', params],
    queryFn: () => getSignalRuleMatches(params),
    refetchInterval: 10000, // refresh every 10s to catch new rule firings
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
