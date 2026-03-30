import { api, postBlob } from './client'
import type { QueryParams } from './client'
import type {
  AiFilterResult,
  AiOntologyQueryRequest,
  AiOntologyQueryResult,
  AiSummaryRequest,
  AiSummaryResult,
  AiSummaryType,
} from './types'

export function getAiFilter(q: string, entityType: 'tasks' | 'signals' = 'tasks'): Promise<{ data: AiFilterResult }> {
  return api.get('/api/ai/filter', { q, entity_type: entityType } as QueryParams)
}

export function postAiSummary(body: AiSummaryRequest): Promise<{ data: AiSummaryResult }> {
  return api.post('/api/ai/summary', body)
}

export function postAiOntologyQuery(body: AiOntologyQueryRequest): Promise<{ data: AiOntologyQueryResult }> {
  return api.post('/api/ai/ontology_query', body)
}

export interface AiExportRequest {
  summary_type:   AiSummaryType
  summary:        string
  citations:      string[]
  context_counts: { audit_events: number; signals: number; rule_fires: number }
  site_name?:     string
}

// Returns a Blob (application/pdf) for client-side download.
export function exportBriefing(body: AiExportRequest): Promise<Blob> {
  return postBlob('/api/ai/export', body)
}
