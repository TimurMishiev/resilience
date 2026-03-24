import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getTelemetry } from '../api/telemetry'
import { type TelemetryMap, type TelemetryReading } from '../lib/telemetry'
import { useTelemetryStream } from './useTelemetryStream'

function toTelemetryMap(rows: TelemetryReading[]): TelemetryMap {
  const map: TelemetryMap = new Map()
  for (const row of rows) map.set(row.asset_id, row)
  return map
}

export function useTelemetry(enabled = true, asOf?: string | null) {
  const live = useTelemetryStream(enabled && !asOf)

  const replayQuery = useQuery({
    queryKey: ['telemetry', { as_of: asOf ?? null }],
    queryFn:  () => getTelemetry({ as_of: asOf! }),
    enabled:  enabled && Boolean(asOf),
    staleTime: Infinity,
  })

  const replayReadings = useMemo(
    () => toTelemetryMap(replayQuery.data?.data ?? []),
    [replayQuery.data?.data],
  )

  if (asOf) {
    return {
      readings: replayReadings,
      connected: !replayQuery.isLoading && !replayQuery.isError,
    }
  }

  return live
}
