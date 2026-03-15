import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getCorrelationRules,
  createCorrelationRule,
  updateCorrelationRule,
  deleteCorrelationRule,
} from '../api/correlation_rules'
import type { CreateCorrelationRuleBody, UpdateCorrelationRuleBody } from '../api/types'

export function useCorrelationRules(params?: { active_only?: boolean }) {
  return useQuery({
    queryKey: ['correlation_rules', params],
    queryFn: () => getCorrelationRules(params),
  })
}

export function useCreateCorrelationRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateCorrelationRuleBody) => createCorrelationRule(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['correlation_rules'] })
    },
  })
}

export function useUpdateCorrelationRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCorrelationRuleBody }) =>
      updateCorrelationRule(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['correlation_rules'] })
    },
  })
}

export function useDeleteCorrelationRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteCorrelationRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['correlation_rules'] })
    },
  })
}
