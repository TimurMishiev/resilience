import { api } from './client'
import type { QueryParams } from './client'
import type { AiFilterResult, AiSummaryRequest, AiSummaryResult } from './types'

export function getAiFilter(q: string): Promise<{ data: AiFilterResult }> {
  return api.get('/api/ai/filter', { q } as QueryParams)
}

export function postAiSummary(body: AiSummaryRequest): Promise<{ data: AiSummaryResult }> {
  return api.post('/api/ai/summary', body)
}
