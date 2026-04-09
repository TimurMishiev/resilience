import type { Signal } from '../api/types'
import type { Vessel, VesselTrack } from '../api/vessels'

const DARK_THRESHOLD_MS = 20 * 60 * 1000

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export function buildReplayVessel(
  signal: Signal | null,
  vesselId: string | null,
  vesselTracks: VesselTrack[],
  asOf: string | null,
): Vessel | null {
  if (!signal || signal.signal_type !== 'vessel_position') return null

  const payload = signal.raw_payload ?? {}
  const latestTrack = vesselTracks[vesselTracks.length - 1] ?? null
  const lastSeenAt = latestTrack?.occurred_at ?? signal.occurred_at
  const cutoffMs = asOf ? Date.parse(asOf) : Number.NaN
  const lastSeenMs = Date.parse(lastSeenAt)

  return {
    id: vesselId ?? `replay-${signal.external_id}`,
    mmsi: stringOrNull(payload['mmsi']) ?? signal.external_id,
    name: stringOrNull(payload['name'])
      ?? stringOrNull(payload['vessel_name'])
      ?? stringOrNull(payload['callsign']),
    vessel_type: stringOrNull(payload['vessel_type']),
    flag: stringOrNull(payload['flag']),
    destination: stringOrNull(payload['dest']) ?? stringOrNull(payload['destination']),
    lat: latestTrack?.lat ?? signal.lat,
    lng: latestTrack?.lng ?? signal.lng,
    speed: latestTrack?.speed ?? signal.speed,
    heading: latestTrack?.heading ?? signal.heading,
    first_seen_at: signal.occurred_at,
    last_seen_at: lastSeenAt,
    loitering_since: null,
    dark: Number.isFinite(cutoffMs) && Number.isFinite(lastSeenMs) ? lastSeenMs < cutoffMs - DARK_THRESHOLD_MS : false,
    loitering: false,
    last_signal_id: signal.id,
  }
}
