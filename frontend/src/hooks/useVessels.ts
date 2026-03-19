import { useQuery } from '@tanstack/react-query'
import { getVessels, getVessel, getVesselTracks } from '../api/vessels'
import type { VesselsParams } from '../api/vessels'

export function useVessels(params?: VesselsParams) {
  return useQuery({
    queryKey: ['vessels', params],
    queryFn:  () => getVessels(params),
    refetchInterval: 30_000,
  })
}

export function useVessel(id: string | null) {
  return useQuery({
    queryKey: ['vessels', id],
    queryFn:  () => getVessel(id!),
    enabled:  !!id,
  })
}

export function useVesselTracks(id: string | null, params?: { from?: string; to?: string; limit?: number }) {
  return useQuery({
    queryKey: ['vessel-tracks', id, params],
    queryFn:  () => getVesselTracks(id!, params),
    enabled:  !!id,
  })
}
