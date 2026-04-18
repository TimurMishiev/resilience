import { useQuery } from '@tanstack/react-query'
import { getAuditEvents } from '../api/audit_events'

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
  'site_unflagged',
  'posture_changed',
  'salute_report.created',
  'recommendation_accepted',
  'recommendation_executed',
]

const DEBRIEF_LIMIT = 200

interface Params {
  range: DebriefRange
  enabled?: boolean
  nowIso?: string
}

export function useDebriefTimeline({ range, enabled = true, nowIso }: Params) {
  return useQuery({
    queryKey: ['debrief_timeline', range, nowIso ?? null],
    queryFn: () => {
      const anchor = nowIso ? new Date(nowIso).getTime() : Date.now()
      const from = new Date(anchor - RANGE_MS[range]).toISOString()
      return getAuditEvents({
        from,
        event_types: MEANINGFUL_DEBRIEF_EVENT_TYPES,
        limit: DEBRIEF_LIMIT,
      })
    },
    enabled,
  })
}
