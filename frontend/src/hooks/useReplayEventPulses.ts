import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getAuditEvents } from '../api/audit_events'
import type { Site } from '../api/types'
import {
  HIGH_SIGNAL_PULSE_EVENT_TYPES,
  PULSE_WINDOW_MS,
  buildPulses,
  buildSitesById,
  type Pulse,
} from '../lib/replayEventPulses'

interface UseReplayEventPulsesArgs {
  asOf: string | null
  isReplaying: boolean
  sites: readonly Site[]
}

/**
 * Tranche 6-A — query the past audit-event window around the replay
 * cursor and resolve to a bounded list of map pulses. Disabled outside
 * replay so live mode pays nothing for this hook.
 *
 * The replay context auto-advances `asOf` every 500ms during playback.
 * Keying the query directly on `asOf` would force one fetch per tick
 * (~2 req/sec to /api/audit_events). The fix is bucket-the-cursor:
 * `asOf` is floored to a CURSOR_BUCKET_MS interval (half PULSE_WINDOW_MS),
 * the queryKey is keyed on that bucket, and the fetch window is the
 * **past-only** `[bucketStart - PULSE_WINDOW_MS, bucketStart]`.
 *
 * Past-only matters: `/api/audit_events` orders by `occurred_at desc`
 * and caps at limit. A wider window that included forward-speculative
 * rows could let a dense burst near the upper bound consume the row
 * budget before the cursor's visible past window made it into the
 * response, leaving the cursor with zero pulses even when relevant
 * past events exist. By fetching only the past window, the
 * descending-order budget always prioritises the most-recent past
 * events — exactly what the cursor wants to render.
 *
 * Trade: while the cursor sweeps within a bucket (≤ CURSOR_BUCKET_MS
 * of replay-time), audit events occurring after `bucketStart` are not
 * yet in the cache. They appear when the cursor crosses into the
 * next bucket. With CURSOR_BUCKET_MS = 2.5 min, the visibility lag
 * is at most 2.5 min of replay-time (≈ 2.5 s of real time at 1×
 * playback; instantaneous at 60×).
 *
 * `buildPulses` still does the per-cursor filtering (within
 * PULSE_WINDOW_MS, past-only), so within a bucket the visible pulse
 * set updates every tick from cached events without a network call.
 *
 * `placeholderData: keepPreviousData` smooths the bucket-boundary
 * refetch — prior pulses keep showing until the new fetch resolves.
 */
const CURSOR_BUCKET_MS = PULSE_WINDOW_MS / 2
const EVENT_TYPES_QUERY = [...HIGH_SIGNAL_PULSE_EVENT_TYPES]

export function useReplayEventPulses({
  asOf,
  isReplaying,
  sites,
}: UseReplayEventPulsesArgs): Pulse[] {
  const enabled = isReplaying && Boolean(asOf)
  const asOfMs = asOf ? Date.parse(asOf) : null
  const bucketCursorMs = asOfMs !== null
    ? Math.floor(asOfMs / CURSOR_BUCKET_MS) * CURSOR_BUCKET_MS
    : null

  const fromIso = useMemo(
    () => (bucketCursorMs !== null ? new Date(bucketCursorMs - PULSE_WINDOW_MS).toISOString() : null),
    [bucketCursorMs],
  )
  const toIso = useMemo(
    () => (bucketCursorMs !== null ? new Date(bucketCursorMs).toISOString() : null),
    [bucketCursorMs],
  )

  const { data: events } = useQuery({
    queryKey: ['replay_event_pulses', bucketCursorMs],
    queryFn: () =>
      getAuditEvents({
        event_types: EVENT_TYPES_QUERY,
        from: fromIso ?? undefined,
        to: toIso ?? undefined,
        limit: 500,
      }),
    enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })

  const sitesById = useMemo(() => buildSitesById(sites), [sites])

  return useMemo(() => {
    if (!enabled || !events || asOfMs === null) return []
    return buildPulses(events, sitesById, asOfMs)
  }, [enabled, events, sitesById, asOfMs])
}
