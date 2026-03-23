import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
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

export function useAreasOfOperation(params?: AreasOfOperationParams) {
  return useQuery({
    queryKey: ['areas_of_operation', params],
    queryFn:  () => getAreasOfOperation(params),
  })
}

export function useCreateAreaOfOperation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateAreaOfOperationBody) => createAreaOfOperation(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas_of_operation'] })
    },
  })
}

export function useUpdateAreaOfOperation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAreaOfOperationBody }) =>
      updateAreaOfOperation(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas_of_operation'] })
    },
  })
}

export function useDeleteAreaOfOperation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteAreaOfOperation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas_of_operation'] })
    },
  })
}

export function useUpdateAreaOfOperationPosture() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, posture }: { id: string; posture: Posture }) =>
      updateAreaOfOperationPosture(id, posture),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas_of_operation'] })
    },
  })
}
