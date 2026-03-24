import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query'
import { getSignals } from '../api/signals'
import type { Signal, SignalType, SignalsParams } from '../api/types'
import { LIVE_SIGNAL_LIMITS, LIVE_SIGNAL_TYPES, mergeSignals, sortSignalsNewestFirst, type SignalMap } from '../lib/liveSignals'
import { useSignalStream } from './useSignalStream'

interface UseSignalsOptions {
  refetchInterval?: number | false
}

interface UseSignalsInfiniteOptions {
  enabled?: boolean
  refetchInterval?: number | false
}

export function useSignals(params?: SignalsParams, options?: UseSignalsOptions) {
  return useQuery({
    queryKey: ['signals', params],
    queryFn: () => getSignals(params),
    refetchInterval: options?.refetchInterval ?? 5000, // auto-refresh every 5s so the feed stays live
  })
}

interface UseSignalsLiveOptions {
  enabled?: boolean
  asOf?: string | null
  replayParams?: Omit<SignalsParams, 'signal_type' | 'page' | 'per_page'>
  limits?: Partial<Record<SignalType, number>>
}

function toSignalMap(signals: Signal[]): SignalMap {
  const map: SignalMap = new Map()
  for (const signal of signals) map.set(signal.id, signal)
  return map
}

function maxSignalIngestedAt(signals: Signal[]): string | null {
  let latest: string | null = null
  for (const signal of signals) {
    if (!latest || Date.parse(signal.ingested_at) > Date.parse(latest)) {
      latest = signal.ingested_at
    }
  }
  return latest
}

export function useSignalsLive(options?: UseSignalsLiveOptions) {
  const enabled = options?.enabled ?? true
  const asOf = options?.asOf ?? null
  const limits = useMemo(
    () => ({ ...LIVE_SIGNAL_LIMITS, ...(options?.limits ?? {}) }),
    [options?.limits],
  )
  const [snapshotCursor, setSnapshotCursor] = useState<string | null>(null)
  const [hasBaselineSync, setHasBaselineSync] = useState(false)

  const live = useSignalStream(enabled && !asOf, { limits, seedCursor: snapshotCursor })

  const snapshotQueries = useQueries({
    queries: LIVE_SIGNAL_TYPES.map(signalType => {
      const params: SignalsParams = asOf
        ? { ...options?.replayParams, as_of: asOf, signal_type: signalType, per_page: limits[signalType] }
        : { signal_type: signalType, per_page: limits[signalType] }

      return {
        queryKey: ['signals', 'snapshot', asOf ? 'replay' : `live-${live.connectionId}`, params],
        queryFn: () => getSignals(params),
        enabled: asOf ? enabled : (enabled && live.connectionId > 0),
        refetchInterval: false as const,
        refetchOnWindowFocus: false as const,
        refetchOnMount: false as const,
        staleTime: asOf ? Infinity : 0,
      }
    }),
  })

  const snapshotSignals = useMemo(
    () => snapshotQueries.flatMap(query => query.data?.data ?? []),
    [snapshotQueries],
  )

  const allSnapshotsSucceeded = snapshotQueries.length > 0 && snapshotQueries.every(query => query.isSuccess)

  useEffect(() => {
    if (!enabled || asOf) {
      const resetId = window.setTimeout(() => {
        setSnapshotCursor(null)
        setHasBaselineSync(false)
      }, 0)
      return () => window.clearTimeout(resetId)
    }
  }, [asOf, enabled])

  useEffect(() => {
    if (asOf || !allSnapshotsSucceeded) return
    const readyId = window.setTimeout(() => {
      setHasBaselineSync(true)
    }, 0)
    return () => window.clearTimeout(readyId)
  }, [allSnapshotsSucceeded, asOf])

  useEffect(() => {
    if (!enabled || asOf) return
    const latestSnapshotCursor = maxSignalIngestedAt(snapshotSignals)
    if (!latestSnapshotCursor) return

    const cursorId = window.setTimeout(() => {
      setSnapshotCursor(previous => {
        if (!previous) return latestSnapshotCursor
        return Date.parse(latestSnapshotCursor) > Date.parse(previous)
          ? latestSnapshotCursor
          : previous
      })
    }, 0)

    return () => window.clearTimeout(cursorId)
  }, [asOf, enabled, snapshotSignals])

  const baselineError = useMemo(() => {
    if (asOf || hasBaselineSync) return null
    const failedQuery = snapshotQueries.find(query => query.isError)
    if (!failedQuery) return null
    return failedQuery.error instanceof Error
      ? failedQuery.error
      : new Error('Live signal baseline sync failed. Recent signals may be incomplete; retrying automatically.')
  }, [asOf, hasBaselineSync, snapshotQueries])

  useEffect(() => {
    if (asOf || !enabled || hasBaselineSync) return

    const failedQueries = snapshotQueries.filter(query => query.isError)
    if (failedQueries.length === 0) return

    const retryId = setTimeout(() => {
      for (const query of failedQueries) {
        void query.refetch()
      }
    }, 5_000)

    return () => clearTimeout(retryId)
  }, [asOf, enabled, hasBaselineSync, snapshotQueries])

  const liveBaselineReady = hasBaselineSync || allSnapshotsSucceeded

  const signals = useMemo(() => {
    if (asOf) return sortSignalsNewestFirst(snapshotSignals)

    const merged = mergeSignals(toSignalMap(snapshotSignals), live.signals, limits)
    if (!liveBaselineReady) return []
    return sortSignalsNewestFirst(Array.from(merged.values()))
  }, [asOf, limits, live.signals, liveBaselineReady, snapshotSignals])

  if (asOf) {
    return {
      signals,
      connected: snapshotQueries.every(query => !query.isLoading && !query.isError),
      isPending: snapshotQueries.some(query => query.isLoading),
      error: snapshotQueries.find(query => query.isError)?.error ?? null,
    }
  }

  return {
    signals,
    connected: live.connected && liveBaselineReady,
    isPending: live.connectionId === 0 || (!liveBaselineReady && !baselineError) || (snapshotQueries.some(query => query.isLoading) && signals.length === 0),
    error: baselineError,
  }
}

const INFINITE_PER_PAGE = 75

// Infinite-scroll variant — used by SignalFeedPage for the virtual list.
// Fetches pages on demand as the user scrolls; each page is 75 rows.
// Filters (source, signal_type) are part of the query key so changing them
// resets to page 1 automatically.
export function useSignalsInfinite(
  params?: Omit<SignalsParams, 'page' | 'per_page'>,
  options?: UseSignalsInfiniteOptions,
) {
  return useInfiniteQuery({
    queryKey: ['signals', 'infinite', params],
    queryFn: ({ pageParam }) =>
      getSignals({ ...params, page: pageParam as number, per_page: INFINITE_PER_PAGE }),
    initialPageParam: 1,
    enabled: options?.enabled ?? true,
    getNextPageParam: (lastPage) => {
      const { page, total_pages } = lastPage.meta
      return page < total_pages ? page + 1 : undefined
    },
    refetchInterval: options?.refetchInterval ?? 30_000, // slower refetch for infinite — avoids layout thrash
  })
}
