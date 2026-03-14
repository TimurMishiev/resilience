import { useQuery } from '@tanstack/react-query'
import { getAuditEvents } from '../api/audit_events'

interface Params {
  entity_type?: string
  entity_id?: string
  limit?: number
}

export function useAuditEvents(params: Params) {
  return useQuery({
    queryKey: ['audit_events', params],
    queryFn: () => getAuditEvents(params),
    enabled: Boolean(params.entity_id),
  })
}
