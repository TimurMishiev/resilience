import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTasks, createTask, updateTask, transitionTask, getAllowedTransitions } from '../api/tasks'
import type { PaginationParams, AsOfParam, WorkflowStatus, TransitionTaskBody, CreateTaskBody, UpdateTaskBody } from '../api/types'

type Params = PaginationParams &
  AsOfParam & {
    site_id?: string | null
    workflow_status?: WorkflowStatus | null
    priority?: string | null
  }

export function useTasks(params?: Params) {
  // Strip null values before passing to API
  const cleaned = params
    ? Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
    : undefined

  return useQuery({
    queryKey: ['tasks', params],
    queryFn: () => getTasks(cleaned),
  })
}

export function useAllowedTransitions(taskId: string | null) {
  return useQuery({
    queryKey: ['tasks', taskId, 'allowed_transitions'],
    queryFn: () => getAllowedTransitions(taskId!),
    enabled: taskId !== null,
  })
}

export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateTaskBody) => createTask(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['readiness'] })
    },
  })
}

export function useUpdateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTaskBody }) =>
      updateTask(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useTransitionTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TransitionTaskBody }) =>
      transitionTask(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}
