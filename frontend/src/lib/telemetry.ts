export interface TelemetryReading {
  asset_id: string
  name:     string
  lat:      number
  lng:      number
  heading:  number
  speed:    number
  battery:  number
  ts:       number
}

export type TelemetryMap = Map<string, TelemetryReading>

export interface AssetTrailPoint {
  lat:     number
  lng:     number
  heading: number
  speed:   number
  ts:      number
}

export interface AssetTrail {
  asset_id: string
  name:     string
  status:   string   // AssetStatus — kept as string to avoid circular import
  points:   AssetTrailPoint[]
}

export interface TimedTelemetryLike {
  ts: number
}

export const TELEMETRY_STALE_AFTER_SECONDS = 90

export function isTelemetryFresh(
  reading: TimedTelemetryLike | undefined | null,
  nowSeconds: number,
) {
  if (!reading) return false
  return nowSeconds - reading.ts <= TELEMETRY_STALE_AFTER_SECONDS
}
