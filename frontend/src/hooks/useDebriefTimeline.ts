import { useInfiniteQuery } from '@tanstack/react-query'
import { getAuditEventsPage } from '../api/audit_events'
import type { AuditEventsCursor } from '../api/types'

export type DebriefRange = '1h' | '6h' | '24h' | '7d'

export const DEBRIEF_RANGE_OPTIONS: { value: DebriefRange; label: string }[] = [
  { value: '1h',  label: 'Last hour' },
  { value: '6h',  label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d',  label: 'Last 7 days' },
]

const RANGE_MS: Record<DebriefRange, number> = {
  '1h':  60 * 60 * 1000,
  '6h':  6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7 * 24 * 60 * 60 * 1000,
}

// Curated list of operationally meaningful event types. Excludes high-volume
// noisy updates (task.updated, incident_updated) and internal bookkeeping
// (incident.fusion_attached). Must match event_type strings emitted anywhere
// in the backend (controllers, models, services).
export const MEANINGFUL_DEBRIEF_EVENT_TYPES: string[] = [
  'incident.opened',
  'incident_transitioned',
  'incident_assigned',
  'note_added',
  'prosecution_started',
  'prosecution_step_added',
  'task.created',
  'task.transitioned',
  'alert.transitioned',
  'asset.status_changed',
  'site_flagged',
  'site_status_changed',
  'site_unflagged',
  'posture_changed',
  'salute_report.created',
  'recommendation_accepted',
  'recommendation_deferred',
  'recommendation_rejected',
  'recommendation_executed',
]

const DEBRIEF_LIMIT = 200

interface Params {
  range: DebriefRange
  enabled?: boolean
  nowIso?: string
}

interface DebriefPageParam {
  anchorIso: string
  cursor: AuditEventsCursor | null
}

export function useDebriefTimeline({ range, enabled = true, nowIso }: Params) {
  const queryKey = ['debrief_timeline', range, nowIso ?? null] as const
  const initialPageParam: DebriefPageParam = {
    anchorIso: nowIso ?? new Date().toISOString(),
    cursor: null,
  }

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => {
      const { anchorIso, cursor } = pageParam
      const anchor = new Date(anchorIso).getTime()
      const from = new Date(anchor - RANGE_MS[range]).toISOString()
      return getAuditEventsPage({
        from,
        to: anchorIso,
        event_types: MEANINGFUL_DEBRIEF_EVENT_TYPES,
        limit: DEBRIEF_LIMIT,
        ...(cursor ?? {}),
      })
    },
    initialPageParam,
    getNextPageParam: (lastPage, _pages, lastPageParam) => (
      lastPage.meta.has_more && lastPage.meta.next_cursor
        ? {
            anchorIso: lastPageParam.anchorIso,
            cursor: lastPage.meta.next_cursor,
          }
        : undefined
    ),
    enabled,
  })

  return {
    ...query,
    events: query.data?.pages.flatMap((page) => page.data) ?? [],
    hasMore: query.hasNextPage ?? false,
    loadMore: query.fetchNextPage,
    isLoadingMore: query.isFetchingNextPage,
  }
}
