import { useQuery } from '@tanstack/react-query'
import { getReadiness, getThroughput } from '../api/readiness'
import type { AsOfParam } from '../api/types'

export function useReadiness(params?: AsOfParam) {
  return useQuery({
    queryKey: ['readiness', params],
    queryFn: () => getReadiness(params),
  })
}

export function useThroughput() {
  return useQuery({
    queryKey: ['analytics', 'throughput'],
    queryFn: () => getThroughput(),
  })
}
