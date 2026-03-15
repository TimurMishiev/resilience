import { useQuery } from '@tanstack/react-query'
import { getSignals } from '../api/signals'
import type { SignalsParams } from '../api/types'

export function useSignals(params?: SignalsParams) {
  return useQuery({
    queryKey: ['signals', params],
    queryFn: () => getSignals(params),
    refetchInterval: 5000, // auto-refresh every 5s so the feed stays live
  })
}
