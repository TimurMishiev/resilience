import { api } from './client'
import type { AuditEvent } from './types'

interface AuditEventsParams {
  entity_type?: string
  entity_id?: string
  limit?: number
}

export function getAuditEvents(params?: AuditEventsParams): Promise<AuditEvent[]> {
  return api.get('/api/audit_events', params)
}
