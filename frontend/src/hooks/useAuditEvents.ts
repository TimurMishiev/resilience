import { useQuery } from '@tanstack/react-query'
import { getAuditEvents } from '../api/audit_events'

interface Params {
  entity_type?: string
  entity_id?: string
  entity_types?: string[]
  event_types?: string[]
  from?: string
  to?: string
  limit?: number
  as_of?: string
}

export function useAuditEvents(params: Params) {
  return useQuery({
    queryKey: ['audit_events', params],
    queryFn: () => getAuditEvents(params),
    enabled: Boolean(params.entity_id),
  })
}
