import { api } from './client'
import type { QueryParams } from './client'
import type {
  CorrelationRule,
  PaginatedResponse,
  PaginationParams,
  CreateCorrelationRuleBody,
  UpdateCorrelationRuleBody,
} from './types'

type RulesParams = PaginationParams & { active_only?: boolean }

export function getCorrelationRules(params?: RulesParams): Promise<PaginatedResponse<CorrelationRule>> {
  return api.get('/api/correlation_rules', params as QueryParams)
}

export function getCorrelationRule(id: string): Promise<CorrelationRule> {
  return api.get(`/api/correlation_rules/${id}`)
}

export function createCorrelationRule(body: CreateCorrelationRuleBody): Promise<CorrelationRule> {
  return api.post('/api/correlation_rules', { correlation_rule: body })
}

export function updateCorrelationRule(id: string, body: UpdateCorrelationRuleBody): Promise<CorrelationRule> {
  return api.patch(`/api/correlation_rules/${id}`, { correlation_rule: body })
}

export function deleteCorrelationRule(id: string): Promise<void> {
  return api.delete(`/api/correlation_rules/${id}`)
}

export interface DryRunMatch {
  signal_id: string
  signal_type: string
  source: string
  lat: number | string
  lng: number | string
  magnitude: number | null
  occurred_at: string
  site_id: string
  site_name: string
  distance_km: number
  would_fire: string[]
}

export interface DryRunResult {
  rule_id: string
  rule_name: string
  window_hours: number
  total_matches: number
  matches: DryRunMatch[]
}

export function dryRunRule(id: string, hours = 24): Promise<DryRunResult> {
  return api.post(`/api/correlation_rules/${id}/dry_run`, { hours })
}
