import { api } from './client'
import type { QueryParams } from './client'
import type { AuditEvent } from './types'

interface AuditEventsParams {
  entity_type?: string
  entity_id?: string
  entity_types?: string[]
  event_types?: string[]
  from?: string
  to?: string
  limit?: number
  as_of?: string
}

export function getAuditEvents(params?: AuditEventsParams): Promise<AuditEvent[]> {
  return api.get('/api/audit_events', params as QueryParams)
}
