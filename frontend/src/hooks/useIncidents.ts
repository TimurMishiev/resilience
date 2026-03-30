import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getIncidents, getIncident, updateIncident, transitionIncident,
  getIncidentAllowedTransitions, assignIncident, getIncidentNotes, addIncidentNote,
  getIncidentChain, initiateProsecution, getProsecutionSteps, addProsecutionStep,
} from '../api/incidents'
import type {
  IncidentParams, IncidentStatus, Incident,
  AddProsecutionStepBody,
} from '../api/incidents'

interface IncidentQueryOptions {
  enabled?: boolean
  refetchInterval?: number | false
}

export function useIncidents(params?: IncidentParams, options?: IncidentQueryOptions) {
  return useQuery({
    queryKey: ['incidents', params],
    queryFn:  () => getIncidents(params),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 15_000,
  })
}

export function useIncident(id: string | undefined, options?: IncidentQueryOptions) {
  return useQuery({
    queryKey: ['incidents', id],
    queryFn:  () => getIncident(id!),
    enabled:  Boolean(id) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? 15_000,
  })
}

export function useIncidentAllowedTransitions(id: string | undefined, options?: IncidentQueryOptions) {
  return useQuery({
    queryKey: ['incident-transitions', id],
    queryFn:  () => getIncidentAllowedTransitions(id!),
    enabled:  Boolean(id) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? 15_000,
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

export function useIncidentNotes(id: string | undefined, options?: IncidentQueryOptions) {
  return useQuery({
    queryKey: ['incident-notes', id],
    queryFn:  () => getIncidentNotes(id!),
    enabled:  Boolean(id) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? 30_000,
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

export function useIncidentChain(id: string | undefined, options?: IncidentQueryOptions) {
  return useQuery({
    queryKey: ['incident-chain', id],
    queryFn:  () => getIncidentChain(id!),
    enabled:  Boolean(id) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? 30_000,
  })
}

// ── Prosecution hooks ─────────────────────────────────────────────────────

export function useProsecutionSteps(id: string | undefined, options?: IncidentQueryOptions) {
  return useQuery({
    queryKey: ['prosecution-steps', id],
    queryFn:  () => getProsecutionSteps(id!),
    enabled:  Boolean(id) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? false,
  })
}

export function useInitiateProsecution() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string | null }) =>
      initiateProsecution(id, notes),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['incidents', id] })
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      queryClient.invalidateQueries({ queryKey: ['prosecution-steps', id] })
    },
  })
}

export function useAddProsecutionStep() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AddProsecutionStepBody }) =>
      addProsecutionStep(id, body),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['prosecution-steps', id] })
      // Invalidate the incident itself so prosecution_phase badge updates
      queryClient.invalidateQueries({ queryKey: ['incidents', id] })
    },
  })
}
