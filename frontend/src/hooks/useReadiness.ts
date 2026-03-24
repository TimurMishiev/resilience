import { useQuery } from '@tanstack/react-query'
import { getReadiness, getThroughput } from '../api/readiness'
import type { AsOfParam } from '../api/types'

interface QueryOptions {
  enabled?: boolean
}

export function useReadiness(params?: AsOfParam, options?: QueryOptions) {
  return useQuery({
    queryKey: ['readiness', params],
    queryFn: () => getReadiness(params),
    enabled: options?.enabled ?? true,
  })
}

export function useThroughput(options?: QueryOptions) {
  return useQuery({
    queryKey: ['analytics', 'throughput'],
    queryFn: () => getThroughput(),
    enabled: options?.enabled ?? true,
  })
}
