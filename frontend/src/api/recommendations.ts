import { api } from './client'
import type { PaginatedResponse } from './types'

export type RecommendationType =
  | 'close_stale_alert'
  | 'acknowledge_alert'
  | 'escalate_incident'
  | 'create_task'
  | 'flag_site'
  | 'bulk_triage_alerts'

export type RecommendationStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'deferred'
  | 'expired'
  | 'executed'

export type RecommendationTier = 'rule' | 'llm'

export interface EvidenceItem {
  type:    'site' | 'incident' | 'alert' | 'task'
  id:      string
  detail?: string
}

export interface Recommendation {
  id:                   string
  recommendation_type:  RecommendationType
  tier:                 RecommendationTier
  status:               RecommendationStatus
  confidence:           number
  rationale:            string
  evidence:             EvidenceItem[]
  action_payload:       Record<string, unknown>
  affected_entity_type: string | null
  affected_entity_id:   string | null
  expires_at:           string
  reviewed_by:          { id: string; email: string } | null
  reviewed_at:          string | null
  review_reason:        string | null
  executed_at:          string | null
  created_at:           string
}

export interface RecommendationMetrics {
  pending:     number
  accepted:    number
  rejected:    number
  deferred:    number
  executed:    number
  expired:     number
  accept_rate: number | null
  by_tier:     { rule: number; llm: number }
  by_type:     Record<string, number>
}

export type RecommendationsResponse = PaginatedResponse<Recommendation>

export interface RecommendationParams {
  status?: string
  tier?:   string
  type?:   string
  [key: string]: string | undefined
}

export function getRecommendations(params?: RecommendationParams): Promise<RecommendationsResponse> {
  return api.get<RecommendationsResponse>('/api/recommendations', params)
}

export function generateRecommendations(): Promise<{ created: number; invalid_count: number }> {
  return api.post<{ created: number; invalid_count: number }>('/api/recommendations/generate', {})
}

export function acceptRecommendation(id: string, reason?: string): Promise<Recommendation> {
  return api.post<Recommendation>(`/api/recommendations/${id}/accept`, { reason })
}

export function rejectRecommendation(id: string, reason?: string): Promise<Recommendation> {
  return api.post<Recommendation>(`/api/recommendations/${id}/reject`, { reason })
}

export function deferRecommendation(id: string, reason?: string): Promise<Recommendation> {
  return api.post<Recommendation>(`/api/recommendations/${id}/defer`, { reason })
}

export function executeRecommendation(id: string): Promise<Recommendation> {
  return api.post<Recommendation>(`/api/recommendations/${id}/execute`, {})
}

export function getRecommendationMetrics(): Promise<RecommendationMetrics> {
  return api.get<RecommendationMetrics>('/api/recommendations/metrics')
}
