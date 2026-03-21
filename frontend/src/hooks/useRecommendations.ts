import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getRecommendations,
  generateRecommendations,
  acceptRecommendation,
  rejectRecommendation,
  deferRecommendation,
  executeRecommendation,
  getRecommendationMetrics,
} from '../api/recommendations'
import type { RecommendationParams } from '../api/recommendations'

export function useRecommendations(params?: RecommendationParams) {
  return useQuery({
    queryKey: ['recommendations', params],
    queryFn:  () => getRecommendations(params),
    refetchInterval: 60_000,
  })
}

export function useRecommendationMetrics() {
  return useQuery({
    queryKey: ['recommendations-metrics'],
    queryFn:  getRecommendationMetrics,
    refetchInterval: 120_000,
  })
}

function useRecMutation<TVariables>(
  mutFn: (v: TVariables) => Promise<unknown>,
  invalidate = true,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: mutFn,
    onSuccess: () => {
      if (invalidate) {
        queryClient.invalidateQueries({ queryKey: ['recommendations'] })
        queryClient.invalidateQueries({ queryKey: ['recommendations-metrics'] })
      }
    },
  })
}

export function useGenerateRecommendations() {
  return useRecMutation(generateRecommendations)
}

export function useAcceptRecommendation() {
  return useRecMutation(({ id, reason }: { id: string; reason?: string }) =>
    acceptRecommendation(id, reason)
  )
}

export function useRejectRecommendation() {
  return useRecMutation(({ id, reason }: { id: string; reason?: string }) =>
    rejectRecommendation(id, reason)
  )
}

export function useDeferRecommendation() {
  return useRecMutation(({ id, reason }: { id: string; reason?: string }) =>
    deferRecommendation(id, reason)
  )
}

export function useExecuteRecommendation() {
  return useRecMutation((id: string) => executeRecommendation(id))
}
