import { useMemo } from 'react'
import { useReplay } from '../context/ReplayContext'

/**
 * Derives the query-param objects that gate all data fetches on the replay
 * timestamp. Centralised here so MapPage, GlobePage, and GraphPage cannot
 * drift in how they encode `as_of` / signal time windows.
 *
 * - asOfParam       — spread into useSites/useTasks/useAssets calls
 * - signalQueryParams — spread into useSignals calls (adds `to` for time window)
 */
export function useReplayParams() {
  const { asOf, isReplaying } = useReplay()

  const asOfParam = asOf ? { as_of: asOf } : {}

  const signalQueryParams = useMemo(
    () => (asOf ? { to: asOf, as_of: asOf } : {}),
    [asOf],
  )

  return { asOf, isReplaying, asOfParam, signalQueryParams }
}
