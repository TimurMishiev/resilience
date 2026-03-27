import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createCommanderIntent,
  createPacePlan,
  createSaluteReport,
  updateCommanderIntent,
  updatePacePlan,
} from '../api/planning'
import type {
  CreateCommanderIntentBody,
  CreatePacePlanBody,
  CreateSaluteReportBody,
  UpdateCommanderIntentBody,
  UpdatePacePlanBody,
} from '../api/types'

export function useCreateCommanderIntent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateCommanderIntentBody) => createCommanderIntent(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planning'] })
    },
  })
}

export function useUpdateCommanderIntent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCommanderIntentBody }) =>
      updateCommanderIntent(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planning'] })
    },
  })
}

export function useCreatePacePlan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreatePacePlanBody) => createPacePlan(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planning'] })
    },
  })
}

export function useUpdatePacePlan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePacePlanBody }) =>
      updatePacePlan(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planning'] })
    },
  })
}

export function useCreateSaluteReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateSaluteReportBody) => createSaluteReport(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planning'] })
    },
  })
}
