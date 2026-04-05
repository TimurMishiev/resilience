import { api } from './client'
import type { PaginatedResponse } from './types'

export interface Organization {
  id: string
  name: string
  slug: string
  user_count: number
  site_count: number
  created_at: string
  updated_at: string
}

export interface OrganizationParams {
  name: string
  slug: string
}

export function getOrganizations(): Promise<PaginatedResponse<Organization>> {
  return api.get('/api/organizations')
}

export function getOrganization(id: string): Promise<Organization> {
  return api.get(`/api/organizations/${id}`)
}

export function createOrganization(params: OrganizationParams): Promise<Organization> {
  return api.post('/api/organizations', { organization: params })
}

export function updateOrganization(id: string, params: Partial<OrganizationParams>): Promise<Organization> {
  return api.patch(`/api/organizations/${id}`, { organization: params })
}

export function deleteOrganization(id: string): Promise<void> {
  return api.delete(`/api/organizations/${id}`)
}
