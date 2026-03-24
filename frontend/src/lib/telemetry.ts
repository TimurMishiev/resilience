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

export interface TimedTelemetryLike {
  ts: number
}

export const TELEMETRY_STALE_AFTER_SECONDS = 90

export function isTelemetryFresh(
  reading: TimedTelemetryLike | undefined | null,
  nowSeconds = Date.now() / 1000,
) {
  if (!reading) return false
  return nowSeconds - reading.ts <= TELEMETRY_STALE_AFTER_SECONDS
}
