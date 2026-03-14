import { useQuery } from '@tanstack/react-query'
import { getAssets } from '../api/assets'
import type { PaginationParams, AsOfParam } from '../api/types'

type Params = PaginationParams & AsOfParam

export function useAssets(params?: Params) {
  return useQuery({
    queryKey: ['assets', params],
    queryFn: () => getAssets(params),
  })
}
