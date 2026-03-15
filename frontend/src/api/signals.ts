import { api } from './client'
import type { QueryParams } from './client'
import type { Signal, PaginatedResponse, SignalsParams } from './types'

export function getSignals(params?: SignalsParams): Promise<PaginatedResponse<Signal>> {
  return api.get('/api/signals', params as QueryParams)
}

export function getSignal(id: string): Promise<Signal> {
  return api.get(`/api/signals/${id}`)
}
