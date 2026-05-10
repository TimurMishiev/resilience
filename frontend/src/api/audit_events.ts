import { api } from './client'
import type { QueryParams } from './client'
import type { AuditEvent, AuditEventsResponse } from './types'

interface AuditEventsParams {
  entity_type?: string
  entity_id?: string
  entity_types?: string[]
  event_types?: string[]
  from?: string
  to?: string
  limit?: number
  as_of?: string
  before_occurred_at?: string
  before_sequence?: number
  before_id?: string
}

export function getAuditEvents(params?: AuditEventsParams): Promise<AuditEvent[]> {
  return getAuditEventsPage(params).then((response) => response.data)
}

export function getAuditEventsPage(params?: AuditEventsParams): Promise<AuditEventsResponse> {
  return api.get('/api/audit_events', params as QueryParams)
}
