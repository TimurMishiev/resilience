import type { Signal, SignalType } from '../api/types'

export type SignalMap = Map<string, Signal>

export const LIVE_SIGNAL_TYPES: SignalType[] = [
  'aircraft_position',
  'vessel_position',
  'seismic_event',
  'gps_jamming',
  'wildfire',
  'conflict_event',
  'disaster_alert',
  'manual',
  'ais_gap',
]

export const LIVE_SIGNAL_LIMITS: Record<SignalType, number> = {
  aircraft_position: 150,
  vessel_position: 50,
  seismic_event: 50,
  gps_jamming: 50,
  wildfire: 50,
  conflict_event: 50,
  disaster_alert: 50,
  manual: 20,
  ais_gap: 20,
}

function occurredAtMs(signal: Signal): number {
  const parsed = Date.parse(signal.occurred_at)
  return Number.isNaN(parsed) ? 0 : parsed
}

export function sortSignalsNewestFirst(signals: Signal[]): Signal[] {
  return [...signals].sort((a, b) => occurredAtMs(b) - occurredAtMs(a))
}

export function pruneSignalMapByType(
  signals: SignalMap,
  limits: Partial<Record<SignalType, number>>,
): SignalMap {
  const next = new Map(signals)

  for (const signalType of LIVE_SIGNAL_TYPES) {
    const limit = limits[signalType]
    if (!limit || limit < 1) continue

    const typedSignals = sortSignalsNewestFirst(
      Array.from(next.values()).filter(signal => signal.signal_type === signalType),
    )

    for (const signal of typedSignals.slice(limit)) {
      next.delete(signal.id)
    }
  }

  return next
}

export function mergeSignals(
  previous: SignalMap,
  incoming: Iterable<Signal>,
  limits: Partial<Record<SignalType, number>>,
): SignalMap {
  const next = new Map(previous)
  for (const signal of incoming) next.set(signal.id, signal)
  return pruneSignalMapByType(next, limits)
}
