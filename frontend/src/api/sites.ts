import { api } from './client'
import type { Site, PaginatedResponse, PaginationParams, AsOfParam } from './types'

type SitesParams = PaginationParams & AsOfParam

export function getSites(params?: SitesParams): Promise<PaginatedResponse<Site>> {
  return api.get('/api/sites', params)
}

export function getSite(id: string, params?: AsOfParam): Promise<Site> {
  return api.get(`/api/sites/${id}`, params)
}
