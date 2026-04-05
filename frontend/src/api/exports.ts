export type ExportEntityType = 'signals' | 'incidents' | 'tasks' | 'audit_events' | 'sites'
export type ExportFormat = 'csv' | 'json'

export interface ExportRequest {
  entity_type: ExportEntityType
  format: ExportFormat
  from?: string
  to?: string
}

export async function createExport(body: ExportRequest): Promise<Blob> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const res = await fetch('/api/exports', {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    let errBody: unknown
    try { errBody = await res.json() } catch { errBody = null }
    const message = errBody && typeof errBody === 'object' && Array.isArray((errBody as Record<string, unknown>).errors)
      ? ((errBody as Record<string, unknown>).errors as string[]).join(', ')
      : `Export failed (${res.status})`
    throw new Error(message)
  }

  return res.blob()
}
