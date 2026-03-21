import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getIncidents, getIncident, updateIncident, transitionIncident,
  getIncidentAllowedTransitions,
} from '../api/incidents'
import type { IncidentParams, IncidentStatus, Incident } from '../api/incidents'

export function useIncidents(params?: IncidentParams) {
  return useQuery({
    queryKey: ['incidents', params],
    queryFn:  () => getIncidents(params),
    refetchInterval: 15_000, // poll every 15s — incidents update as alerts are triaged
  })
}

export function useIncident(id: string | undefined) {
  return useQuery({
    queryKey: ['incidents', id],
    queryFn:  () => getIncident(id!),
    enabled:  Boolean(id),
    refetchInterval: 15_000,
  })
}

export function useIncidentAllowedTransitions(id: string | undefined) {
  return useQuery({
    queryKey: ['incident-transitions', id],
    queryFn:  () => getIncidentAllowedTransitions(id!),
    enabled:  Boolean(id),
  })
}

export function useUpdateIncident() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<Pick<Incident, 'title' | 'description' | 'severity'>>) =>
      updateIncident(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
    },
  })
}

export function useTransitionIncident() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, to_status }: { id: string; to_status: IncidentStatus }) =>
      transitionIncident(id, to_status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      queryClient.invalidateQueries({ queryKey: ['incident-transitions'] })
    },
  })
}
