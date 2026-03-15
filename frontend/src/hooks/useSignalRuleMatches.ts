import { useQuery } from '@tanstack/react-query'
import { getSignalRuleMatches } from '../api/signal_rule_matches'
import type { SignalRuleMatchesParams } from '../api/types'

export function useSignalRuleMatches(params?: SignalRuleMatchesParams) {
  return useQuery({
    queryKey: ['signal_rule_matches', params],
    queryFn: () => getSignalRuleMatches(params),
    refetchInterval: 10000, // refresh every 10s to catch new rule firings
  })
}
