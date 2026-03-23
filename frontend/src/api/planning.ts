import { api } from './client'
import type { PlanningResponse } from './types'

export function getPlanning(): Promise<PlanningResponse> {
  return api.get('/api/planning')
}
