import { postBlob } from './client'

export type ExportEntityType = 'signals' | 'incidents' | 'tasks' | 'audit_events' | 'sites'
export type ExportFormat = 'csv' | 'json'

export interface ExportRequest {
  entity_type: ExportEntityType
  format: ExportFormat
  from?: string
  to?: string
}

export function createExport(body: ExportRequest): Promise<Blob> {
  return postBlob('/api/exports', body)
}
