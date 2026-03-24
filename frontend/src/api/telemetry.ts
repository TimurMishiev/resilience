import { api } from './client'
import type { QueryParams } from './client'
import type { AsOfParam } from './types'
import type { TelemetryReading } from '../lib/telemetry'

export interface TelemetrySnapshotResponse {
  data: TelemetryReading[]
  meta: {
    as_of: string
    total: number
  }
}

export function getTelemetry(params?: AsOfParam): Promise<TelemetrySnapshotResponse> {
  return api.get('/api/telemetry', params as QueryParams)
}
