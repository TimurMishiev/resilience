import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getIncidents, getIncident, updateIncident, transitionIncident,
  getIncidentAllowedTransitions, assignIncident, getIncidentNotes, addIncidentNote,
  getIncidentChain,
} from '../api/incidents'
import type { IncidentParams, IncidentStatus, Incident } from '../api/incidents'

export function useIncidents(params?: IncidentParams) {
  return useQuery({
    queryKey: ['incidents', params],
    queryFn:  () => getIncidents(params),
    refetchInterval: 15_000,
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
    refetchInterval: 15_000,
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

interface MutationCallbacks<TVariables> {
  onMutate?:  (variables: TVariables) => void
  onSettled?: () => void
}

export function useTransitionIncident(callbacks?: MutationCallbacks<{ id: string; to_status: IncidentStatus }>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, to_status }: { id: string; to_status: IncidentStatus }) =>
      transitionIncident(id, to_status),
    onMutate: callbacks?.onMutate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      queryClient.invalidateQueries({ queryKey: ['incident-transitions'] })
    },
    onSettled: callbacks?.onSettled,
  })
}

export function useAssignIncident(callbacks?: MutationCallbacks<{ id: string; assignee_id: string | null }>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, assignee_id }: { id: string; assignee_id: string | null }) =>
      assignIncident(id, assignee_id),
    onMutate: callbacks?.onMutate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
    },
    onSettled: callbacks?.onSettled,
  })
}

export function useIncidentNotes(id: string | undefined) {
  return useQuery({
    queryKey: ['incident-notes', id],
    queryFn:  () => getIncidentNotes(id!),
    enabled:  Boolean(id),
    refetchInterval: 30_000,
  })
}

export function useAddIncidentNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      addIncidentNote(id, body),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['incident-notes', id] })
    },
  })
}

export function useIncidentChain(id: string | undefined) {
  return useQuery({
    queryKey: ['incident-chain', id],
    queryFn:  () => getIncidentChain(id!),
    enabled:  Boolean(id),
    refetchInterval: 30_000,
  })
}
