import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAssetTrails } from '../api/telemetry'
import type { AssetTrail } from '../lib/telemetry'

const EMPTY_TRAILS: AssetTrail[] = []

/**
 * Fetches windowed asset trail points for replay polylines.
 * Returns [] when not replaying — trails are replay-only; live mode uses the
 * SSE stream for current positions.
 */
export function useAssetTrails(asOf: string | null | undefined) {
  const query = useQuery({
    queryKey:             ['asset-trails', { as_of: asOf ?? null }],
    queryFn:              () => getAssetTrails({ as_of: asOf! }),
    enabled:              Boolean(asOf),
    staleTime:            Infinity,
    refetchOnWindowFocus: false,
  })

  const trails = useMemo(
    () => query.data?.data ?? EMPTY_TRAILS,
    [query.data?.data],
  )

  return trails
}
