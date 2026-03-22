import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAssets, updateAssetStatus } from '../api/assets'
import type { PaginationParams, AsOfParam } from '../api/types'

type Params = PaginationParams & AsOfParam & {
  home_site_id?: string
  status?: string
  asset_type?: string
}

export function useAssets(params?: Params) {
  return useQuery({
    queryKey: ['assets', params],
    queryFn: () => getAssets(params),
  })
}

export function useUpdateAssetStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updateAssetStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] })
    },
  })
}
