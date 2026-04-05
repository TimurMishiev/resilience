import { api } from './client'
import type { PaginatedResponse } from './types'

export interface UserRecord {
  id: string
  email: string
  role: string
  organization_id: string | null
  organization_name: string | null
  area_of_operation_id: string | null
  area_of_operation_name: string | null
  created_at: string
  updated_at: string
}

export interface UserUpdateParams {
  role?: string
  organization_id?: string | null
  area_of_operation_id?: string | null
}

export function getUsers(): Promise<PaginatedResponse<UserRecord>> {
  return api.get('/api/users')
}

export function updateUser(id: string, params: UserUpdateParams): Promise<UserRecord> {
  return api.patch(`/api/users/${id}`, { user: params })
}
