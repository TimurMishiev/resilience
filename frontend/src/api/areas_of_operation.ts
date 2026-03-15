import { api } from './client'
import type { QueryParams } from './client'
import type {
  AreaOfOperation,
  PaginatedResponse,
  CreateAreaOfOperationBody,
  UpdateAreaOfOperationBody,
  AreasOfOperationParams,
} from './types'

export function getAreasOfOperation(
  params?: AreasOfOperationParams
): Promise<PaginatedResponse<AreaOfOperation>> {
  return api.get('/api/areas_of_operation', params as QueryParams)
}

export function getAreaOfOperation(id: string): Promise<AreaOfOperation> {
  return api.get(`/api/areas_of_operation/${id}`)
}

export function createAreaOfOperation(
  body: CreateAreaOfOperationBody
): Promise<AreaOfOperation> {
  return api.post('/api/areas_of_operation', { area_of_operation: body })
}

export function updateAreaOfOperation(
  id: string,
  body: UpdateAreaOfOperationBody
): Promise<AreaOfOperation> {
  return api.patch(`/api/areas_of_operation/${id}`, { area_of_operation: body })
}

export function deleteAreaOfOperation(id: string): Promise<void> {
  return api.delete(`/api/areas_of_operation/${id}`)
}
