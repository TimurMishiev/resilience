import { useQuery } from '@tanstack/react-query'
import { getFeedHealth, getOperationalHealth } from '../api/operational_health'

export function useFeedHealth(enabled = true) {
  return useQuery({
    queryKey: ['feedHealth'],
    queryFn: getFeedHealth,
    refetchInterval: 30_000,
    enabled,
  })
}

export function useOperationalHealth(enabled = true) {
  return useQuery({
    queryKey: ['operationalHealth'],
    queryFn: getOperationalHealth,
    refetchInterval: 30_000,
    enabled,
  })
}
