import { api } from './client'
import type { ReadinessScore, AsOfParam } from './types'

export function getReadiness(params?: AsOfParam): Promise<ReadinessScore> {
  return api.get('/api/readiness', params)
}
