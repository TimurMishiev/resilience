import { api } from './client'
import type { Asset, PaginatedResponse, PaginationParams, AsOfParam } from './types'

type AssetsParams = PaginationParams & AsOfParam

export function getAssets(params?: AssetsParams): Promise<PaginatedResponse<Asset>> {
  return api.get('/api/assets', params)
}

export function getAsset(id: string, params?: AsOfParam): Promise<Asset> {
  return api.get(`/api/assets/${id}`, params)
}
