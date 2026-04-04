import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useReplayGuardedMutation } from './useReplayGuardedMutation'
import {
  getAreaOfOperation,
  getAreasOfOperation,
  createAreaOfOperation,
  updateAreaOfOperation,
  deleteAreaOfOperation,
  updateAreaOfOperationPosture,
} from '../api/areas_of_operation'
import type {
  AreasOfOperationParams,
  CreateAreaOfOperationBody,
  UpdateAreaOfOperationBody,
  Posture,
} from '../api/types'

export function useAreaOfOperation(id: string | undefined) {
  return useQuery({
    queryKey: ['areas_of_operation', id],
    queryFn:  () => getAreaOfOperation(id!),
    enabled:  Boolean(id),
  })
}

export function useAreasOfOperation(params?: AreasOfOperationParams, options?: { enabled?: boolean; staleTime?: number }) {
  return useQuery({
    queryKey:  ['areas_of_operation', params],
    queryFn:   () => getAreasOfOperation(params),
    enabled:   options?.enabled ?? true,
    staleTime: options?.staleTime,
  })
}

export function useCreateAreaOfOperation() {
  const queryClient = useQueryClient()
  return useReplayGuardedMutation({
    mutationFn: (body: CreateAreaOfOperationBody) => createAreaOfOperation(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas_of_operation'] })
    },
  })
}

export function useUpdateAreaOfOperation() {
  const queryClient = useQueryClient()
  return useReplayGuardedMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAreaOfOperationBody }) =>
      updateAreaOfOperation(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas_of_operation'] })
    },
  })
}

export function useDeleteAreaOfOperation() {
  const queryClient = useQueryClient()
  return useReplayGuardedMutation({
    mutationFn: (id: string) => deleteAreaOfOperation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas_of_operation'] })
    },
  })
}

export function useUpdateAreaOfOperationPosture() {
  const queryClient = useQueryClient()
  return useReplayGuardedMutation({
    mutationFn: ({ id, posture }: { id: string; posture: Posture }) =>
      updateAreaOfOperationPosture(id, posture),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas_of_operation'] })
    },
  })
}
