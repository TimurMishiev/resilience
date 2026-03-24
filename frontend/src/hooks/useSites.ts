import { useQuery } from '@tanstack/react-query'
import { getSites } from '../api/sites'
import type { PaginationParams, AsOfParam } from '../api/types'

type Params = PaginationParams & AsOfParam

export function useSites(params?: Params, enabled = true) {
  return useQuery({
    queryKey: ['sites', params],
    queryFn: () => getSites(params),
    enabled,
  })
}
