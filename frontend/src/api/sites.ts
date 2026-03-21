import { api } from './client'
import type { QueryParams } from './client'
import type { Site, PaginatedResponse, PaginationParams, AsOfParam, SiteTimelineResponse, SiteTimelineParams } from './types'

type SitesParams = PaginationParams & AsOfParam

export function getSites(params?: SitesParams): Promise<PaginatedResponse<Site>> {
  return api.get('/api/sites', params as QueryParams)
}

export function getSite(id: string, params?: AsOfParam): Promise<Site> {
  return api.get(`/api/sites/${id}`, params as QueryParams)
}

export function unflagSite(id: string): Promise<Site> {
  return api.patch(`/api/sites/${id}/unflag`, {})
}

export function toggleSiteStatus(id: string): Promise<Site> {
  return api.patch(`/api/sites/${id}/toggle_status`, {})
}

export function getSiteTimeline(id: string, params?: SiteTimelineParams): Promise<SiteTimelineResponse> {
  return api.get(`/api/sites/${id}/timeline`, params as QueryParams)
}
