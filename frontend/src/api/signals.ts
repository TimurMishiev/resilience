import { api } from './client'
import type { QueryParams } from './client'
import type { Signal, PaginatedResponse, SignalsParams } from './types'

export function getSignals(params?: SignalsParams): Promise<PaginatedResponse<Signal>> {
  return api.get('/api/signals', params as QueryParams)
}

export function getSignal(id: string): Promise<Signal> {
  return api.get(`/api/signals/${id}`)
}

export interface InjectSignalBody {
  signal_type: string
  lat: number
  lng: number
  magnitude?: number | null
  note?: string | null
}

export function injectSignal(body: InjectSignalBody): Promise<Signal> {
  return api.post('/api/signals', { signal: body })
}
