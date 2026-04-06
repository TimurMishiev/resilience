import { api } from './client'
import type { SiteRiskScore } from './types'

export async function getRiskScores(): Promise<SiteRiskScore[]> {
  const res = await api.get<{ data: SiteRiskScore[] }>('/api/risk_scores')
  return res.data
}
