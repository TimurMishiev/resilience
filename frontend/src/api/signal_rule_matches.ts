import { api } from './client'
import type { QueryParams } from './client'
import type {
  SignalRuleMatch,
  PaginatedResponse,
  SignalRuleMatchesParams,
  TransitionAlertBody,
  AllowedTransitionsResponse,
} from './types'

export function getSignalRuleMatches(params?: SignalRuleMatchesParams): Promise<PaginatedResponse<SignalRuleMatch>> {
  return api.get('/api/signal_rule_matches', params as QueryParams)
}

export function getSignalRuleMatch(id: string): Promise<SignalRuleMatch> {
  return api.get(`/api/signal_rule_matches/${id}`)
}

export function transitionAlert(id: string, body: TransitionAlertBody): Promise<SignalRuleMatch> {
  return api.post(`/api/signal_rule_matches/${id}/transition`, { transition: body })
}

export function getAllowedTransitions(id: string): Promise<AllowedTransitionsResponse> {
  return api.get(`/api/signal_rule_matches/${id}/allowed_transitions`)
}

export interface BulkTransitionBody {
  ids:       string[]
  to_status: string
  notes?:    string
}

export interface BulkTransitionResult {
  succeeded: { id: string; workflow_status: string }[]
  failed:    { id: string; errors: string[] }[]
}

export function bulkTransitionAlerts(body: BulkTransitionBody): Promise<BulkTransitionResult> {
  return api.post('/api/signal_rule_matches/bulk_transition', body)
}
