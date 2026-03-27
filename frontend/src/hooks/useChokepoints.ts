import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createChokepoint,
  deleteChokepoint,
  getChokepoints,
  updateChokepoint,
} from '../api/chokepoints'
import type {
  ChokepointsParams,
  CreateChokepointBody,
  UpdateChokepointBody,
} from '../api/types'

export function useChokepoints(params?: ChokepointsParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['chokepoints', params],
    queryFn: () => getChokepoints(params),
    enabled: options?.enabled ?? true,
  })
}

export function useCreateChokepoint() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateChokepointBody) => createChokepoint(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planning'] })
      queryClient.invalidateQueries({ queryKey: ['chokepoints'] })
    },
  })
}

export function useUpdateChokepoint() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateChokepointBody }) => updateChokepoint(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planning'] })
      queryClient.invalidateQueries({ queryKey: ['chokepoints'] })
    },
  })
}

export function useDeleteChokepoint() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteChokepoint(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planning'] })
      queryClient.invalidateQueries({ queryKey: ['chokepoints'] })
    },
  })
}
