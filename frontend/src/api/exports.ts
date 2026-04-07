import { postBlob } from './client'

export type ExportEntityType = 'signals' | 'incidents' | 'tasks' | 'audit_events' | 'sites' | 'signal_rule_matches'
export type ExportFormat = 'csv' | 'json'

export interface ExportFilters {
  source?: string
  signal_type?: string
  status?: string
  severity?: string
  workflow_status?: string
  site_id?: string
  rule_id?: string
  priority?: string
  from?: string
  to?: string
}

export interface ExportRequest extends ExportFilters {
  entity_type: ExportEntityType
  format: ExportFormat
}

export function createExport(body: ExportRequest): Promise<Blob> {
  return postBlob('/api/exports', body)
}
