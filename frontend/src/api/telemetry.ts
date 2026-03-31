import { api } from './client'
import type { QueryParams } from './client'
import type { AsOfParam } from './types'
import type { TelemetryReading, AssetTrail } from '../lib/telemetry'

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

// ---------------------------------------------------------------------------
// Asset trails — windowed multi-asset trail points for replay polylines
// ---------------------------------------------------------------------------

export interface AssetTrailsParams {
  as_of?:          string
  window_minutes?: number
}

export interface AssetTrailsResponse {
  data: AssetTrail[]
  meta: {
    as_of:          string
    from:           string
    window_minutes: number
    asset_count:    number
  }
}

export function getAssetTrails(params?: AssetTrailsParams): Promise<AssetTrailsResponse> {
  return api.get('/api/telemetry/trails', params as QueryParams)
}
