import { api } from './client'
import type { SiteRiskScore } from './types'

export function getRiskScores(): Promise<SiteRiskScore[]> {
  return api.get('/api/risk_scores')
}
