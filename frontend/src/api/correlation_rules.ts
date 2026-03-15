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
