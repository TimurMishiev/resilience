import { useQuery } from '@tanstack/react-query'
import { getSite } from '../api/sites'

export function useSite(id: string | undefined) {
  return useQuery({
    queryKey: ['sites', id],
    queryFn: () => getSite(id!),
    enabled: Boolean(id),
  })
}
