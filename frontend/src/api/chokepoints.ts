import { api } from './client'
import type { QueryParams } from './client'
import type {
  Chokepoint,
  ChokepointsParams,
  CreateChokepointBody,
  PaginatedResponse,
  UpdateChokepointBody,
} from './types'

export function getChokepoints(params?: ChokepointsParams): Promise<PaginatedResponse<Chokepoint>> {
  return api.get('/api/chokepoints', params as QueryParams | undefined)
}

export function createChokepoint(body: CreateChokepointBody): Promise<Chokepoint> {
  return api.post('/api/chokepoints', { chokepoint: body })
}

export function updateChokepoint(id: string, body: UpdateChokepointBody): Promise<Chokepoint> {
  return api.patch(`/api/chokepoints/${id}`, { chokepoint: body })
}

export function deleteChokepoint(id: string): Promise<void> {
  return api.delete(`/api/chokepoints/${id}`)
}
