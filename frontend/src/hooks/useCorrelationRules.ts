import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getCorrelationRules,
  createCorrelationRule,
  updateCorrelationRule,
  deleteCorrelationRule,
  getRuleEffectiveness,
} from '../api/correlation_rules'
import type { CreateCorrelationRuleBody, UpdateCorrelationRuleBody } from '../api/types'

interface QueryOptions {
  enabled?: boolean
}

export function useCorrelationRules(params?: { active_only?: boolean }, options?: QueryOptions) {
  return useQuery({
    queryKey: ['correlation_rules', params],
    queryFn: () => getCorrelationRules(params),
    enabled: options?.enabled ?? true,
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

// Returns per-rule effectiveness stats indexed by rule_id.
// Fetched once per page load; stale after 5 minutes (analytics are not real-time).
export function useRuleEffectiveness(options?: QueryOptions) {
  return useQuery({
    queryKey: ['correlation_rules', 'effectiveness'],
    queryFn:  getRuleEffectiveness,
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  })
}
