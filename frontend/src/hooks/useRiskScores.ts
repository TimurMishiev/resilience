import { useQuery } from '@tanstack/react-query'
import { getRiskScores } from '../api/riskScores'

interface UseRiskScoresOptions {
  enabled?: boolean
  refetchInterval?: number | false
}

export function useRiskScores(options?: UseRiskScoresOptions) {
  return useQuery({
    queryKey: ['risk_scores'],
    queryFn:  getRiskScores,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 60_000, // risk scores are heavier to compute — refresh every 60s
  })
}
