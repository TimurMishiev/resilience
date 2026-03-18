import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSite, unflagSite, toggleSiteStatus } from '../api/sites'

export function useSite(id: string | undefined) {
  return useQuery({
    queryKey: ['sites', id],
    queryFn: () => getSite(id!),
    enabled: Boolean(id),
  })
}

export function useUnflagSite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unflagSite(id),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['sites'] })
      queryClient.setQueryData(['sites', updated.id], updated)
    },
  })
}

export function useToggleSiteStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => toggleSiteStatus(id),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['sites'] })
      queryClient.setQueryData(['sites', updated.id], updated)
    },
  })
}
