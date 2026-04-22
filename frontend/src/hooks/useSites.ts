import { useQuery } from '@tanstack/react-query'
import { getSites } from '../api/sites'
import type { PaginationParams, AsOfParam } from '../api/types'
import { fetchAllPaginated } from './fetchAllPaginated'

type Params = PaginationParams & AsOfParam

export function useSites(params?: Params, enabled = true) {
  return useQuery({
    queryKey: ['sites', params],
    queryFn: () => getSites(params),
    enabled,
  })
}

export function useAllSites(params?: Omit<Params, 'page' | 'per_page'>, enabled = true) {
  return useQuery({
    queryKey: ['sites', 'all', params],
    queryFn: ({ signal }) => fetchAllPaginated(getSites, params, { signal }),
    enabled,
  })
}
