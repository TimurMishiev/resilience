import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useReplayGuardedMutation } from './useReplayGuardedMutation'
import { getSite, unflagSite, toggleSiteStatus, getSiteTimeline, getSiteRiskHistory, updateSiteGeofence } from '../api/sites'
import type { SiteTimelineParams, SiteRiskHistoryParams } from '../api/types'

export function useSite(id: string | undefined) {
  return useQuery({
    queryKey: ['sites', id],
    queryFn: () => getSite(id!),
    enabled: Boolean(id),
  })
}

export function useUnflagSite() {
  const queryClient = useQueryClient()
  return useReplayGuardedMutation({
    mutationFn: (id: string) => unflagSite(id),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['sites'] })
      queryClient.setQueryData(['sites', updated.id], updated)
    },
  })
}

export function useSiteRiskHistory(id: string | undefined, params?: SiteRiskHistoryParams) {
  return useQuery({
    queryKey: ['site-risk-history', id, params],
    queryFn:  () => getSiteRiskHistory(id!, params),
    enabled:  Boolean(id),
    refetchInterval: 60_000, // refresh every minute — new snapshots arrive hourly
  })
}

export function useSiteTimeline(id: string | undefined, params?: SiteTimelineParams) {
  return useQuery({
    queryKey: ['site-timeline', id, params],
    queryFn:  () => getSiteTimeline(id!, params),
    enabled:  Boolean(id),
    refetchInterval: 30_000, // refresh every 30s — new signals/rule fires appear
  })
}

export function useToggleSiteStatus() {
  const queryClient = useQueryClient()
  return useReplayGuardedMutation({
    mutationFn: (id: string) => toggleSiteStatus(id),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['sites'] })
      queryClient.setQueryData(['sites', updated.id], updated)
    },
  })
}

export function useUpdateSiteGeofence() {
  const queryClient = useQueryClient()
  return useReplayGuardedMutation({
    mutationFn: ({ id, geofence_radius_km }: { id: string; geofence_radius_km: number }) =>
      updateSiteGeofence(id, geofence_radius_km),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['sites'] })
      queryClient.setQueryData(['sites', updated.id], updated)
    },
  })
}
