import { api } from './client'
import type { QueryParams } from './client'
import type { AsOfParam, SiteRiskScore } from './types'

export async function getRiskScores(params?: AsOfParam): Promise<SiteRiskScore[]> {
  const res = await api.get<{ data: SiteRiskScore[] }>('/api/risk_scores', params as QueryParams)
  return res.data
}
