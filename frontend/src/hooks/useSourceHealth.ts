import { useEffect, useMemo, useState } from 'react'
import type { ConnectionStatus } from './useEventSource'
import {
  connectionToFreshness,
  deriveFreshness,
  worstFreshness,
  type FreshnessState,
} from '../lib/freshness'

/** Ticks every 10s so freshness transitions are detected promptly. */
function useFreshnessClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

export interface SourceHealthState {
  /** SSE event stream freshness (derived from ConnectionStatus) */
  sse: FreshnessState
  /** React Query data freshness (derived from dataUpdatedAt) */
  data: FreshnessState
  /** Worst of all tracked sources — the single value for aggregate display */
  aggregate: FreshnessState
}

/**
 * Aggregates SSE connection status and React Query data freshness into a
 * unified SourceHealthState.
 *
 * This hook is the single source of truth for system-level freshness.
 * Phase 1 starts with two sources (SSE + data polling); additional sources
 * (signal stream, telemetry stream) can be added later without changing
 * the interface.
 *
 * @param sseStatus - ConnectionStatus from useEventSource / useSseEvents
 * @param dataUpdatedAt - React Query's dataUpdatedAt from a representative query (0 = no data)
 */
export function useSourceHealth(
  sseStatus: ConnectionStatus,
  dataUpdatedAt: number,
): SourceHealthState {
  const nowMs = useFreshnessClock()

  return useMemo(() => {
    const sse = connectionToFreshness(sseStatus)
    const data = deriveFreshness(dataUpdatedAt, nowMs)
    const aggregate = worstFreshness([sse, data])
    return { sse, data, aggregate }
  }, [sseStatus, dataUpdatedAt, nowMs])
}
