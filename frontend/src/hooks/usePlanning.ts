import { useQuery } from '@tanstack/react-query'
import { getPlanning } from '../api/planning'

export function usePlanning(enabled = true) {
  return useQuery({
    queryKey: ['planning'],
    queryFn:  getPlanning,
    enabled,
    // Planning data is re-fetched on task/task-transition/posture/doctrine/
    // chokepoint SSE events in AppShell, so a 60s stale window avoids
    // redundant background polls.
    staleTime: 60_000,
  })
}
