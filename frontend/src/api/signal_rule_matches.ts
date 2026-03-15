import { api } from './client'
import type { QueryParams } from './client'
import type { SignalRuleMatch, PaginatedResponse, SignalRuleMatchesParams } from './types'

export function getSignalRuleMatches(params?: SignalRuleMatchesParams): Promise<PaginatedResponse<SignalRuleMatch>> {
  return api.get('/api/signal_rule_matches', params as QueryParams)
}

export function getSignalRuleMatch(id: string): Promise<SignalRuleMatch> {
  return api.get(`/api/signal_rule_matches/${id}`)
}
