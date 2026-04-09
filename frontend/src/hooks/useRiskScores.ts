import { useQuery } from '@tanstack/react-query'
import { getRiskScores } from '../api/riskScores'
import type { AsOfParam } from '../api/types'

interface UseRiskScoresOptions {
  enabled?: boolean
  refetchInterval?: number | false
}

export function useRiskScores(params?: AsOfParam, options?: UseRiskScoresOptions) {
  return useQuery({
    queryKey: ['risk_scores', params],
    queryFn:  () => getRiskScores(params),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 60_000, // risk scores are heavier to compute — refresh every 60s
  })
}
