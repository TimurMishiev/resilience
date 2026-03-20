import { useQuery } from '@tanstack/react-query'
import { getRiskScores } from '../api/riskScores'

export function useRiskScores() {
  return useQuery({
    queryKey: ['risk_scores'],
    queryFn:  getRiskScores,
    refetchInterval: 60_000, // risk scores are heavier to compute — refresh every 60s
  })
}
