import { api } from './client'
import type { QueryParams } from './client'
import type { SiteReadiness, ThroughputPoint, AsOfParam, SwimlaneParams, SwimlaneResponse } from './types'

export function getReadiness(params?: AsOfParam): Promise<SiteReadiness[]> {
  return api.get('/api/readiness', params as QueryParams)
}

export function getThroughput(): Promise<{ data: ThroughputPoint[] }> {
  return api.get('/api/analytics/throughput')
}

export function getSwimlane(params?: SwimlaneParams): Promise<SwimlaneResponse> {
  return api.get('/api/analytics/swimlane', params as QueryParams)
}
