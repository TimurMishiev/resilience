import { useQuery } from '@tanstack/react-query'
import { getPlanning } from '../api/planning'
import { useReplay } from '../context/ReplayContext'

export function usePlanning(enabled = true) {
  const { asOf } = useReplay()

  return useQuery({
    queryKey: ['planning', { as_of: asOf ?? null }],
    queryFn:  () => getPlanning({ as_of: asOf }),
    enabled,
    // Planning data is re-fetched on task/task-transition/posture/doctrine/
    // chokepoint SSE events in AppShell, so a 60s stale window avoids
    // redundant background polls.
    staleTime: 60_000,
  })
}
