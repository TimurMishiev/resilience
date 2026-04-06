import { api } from './client'
import type { QueryParams } from './client'
import type { SiteReadiness, ThroughputPoint, AsOfParam, SwimlaneParams, SwimlaneResponse } from './types'

export async function getReadiness(params?: AsOfParam): Promise<SiteReadiness[]> {
  const res = await api.get<{ data: SiteReadiness[] }>('/api/readiness', params as QueryParams)
  return res.data
}

export function getThroughput(): Promise<{ data: ThroughputPoint[] }> {
  return api.get('/api/analytics/throughput')
}

export function getSwimlane(params?: SwimlaneParams): Promise<SwimlaneResponse> {
  return api.get('/api/analytics/swimlane', params as QueryParams)
}
