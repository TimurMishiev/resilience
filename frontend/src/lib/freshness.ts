/**
 * Describes the freshness of a data source or aggregate system state.
 *
 * - fresh:       data was updated recently and the source is healthy
 * - aging:       data is getting old but may still be usable
 * - stale:       data has not been refreshed within the expected window
 * - unavailable: no data has ever arrived or the source is disconnected
 */
export type FreshnessState = 'fresh' | 'aging' | 'stale' | 'unavailable'

/** Mirror of ConnectionStatus from useEventSource, kept here to avoid lib → hooks coupling. */
type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface FreshnessThresholds {
  /** Milliseconds after which data transitions from fresh → aging */
  agingMs: number
  /** Milliseconds after which data transitions from aging → stale */
  staleMs: number
}

const DEFAULT_THRESHOLDS: FreshnessThresholds = {
  agingMs: 30_000,   // 30 seconds
  staleMs: 120_000,  // 2 minutes
}

/**
 * Derives a FreshnessState from the last-updated timestamp and current time.
 *
 * Returns 'unavailable' if lastUpdatedMs is 0 or negative (no data received).
 * Otherwise compares the age against the provided thresholds.
 */
export function deriveFreshness(
  lastUpdatedMs: number,
  nowMs: number,
  thresholds: FreshnessThresholds = DEFAULT_THRESHOLDS,
): FreshnessState {
  if (lastUpdatedMs <= 0) return 'unavailable'

  const ageMs = nowMs - lastUpdatedMs
  if (ageMs < 0) return 'fresh' // clock skew or future timestamp — treat as fresh
  if (ageMs < thresholds.agingMs) return 'fresh'
  if (ageMs < thresholds.staleMs) return 'aging'
  return 'stale'
}

/**
 * Maps an SSE ConnectionStatus to its equivalent FreshnessState.
 *
 * - connected    → fresh  (stream is alive and delivering events)
 * - connecting   → aging  (attempting to connect — data may be outdated)
 * - disconnected → stale  (no stream — data is definitely not updating)
 */
export function connectionToFreshness(status: ConnectionStatus): FreshnessState {
  if (status === 'connected') return 'fresh'
  if (status === 'connecting') return 'aging'
  return 'stale'
}

/** Rank for comparison: lower is healthier. */
const FRESHNESS_RANK: Record<FreshnessState, number> = {
  fresh: 0,
  aging: 1,
  stale: 2,
  unavailable: 3,
}

/**
 * Returns the worst (least healthy) FreshnessState from a list of states.
 * Returns 'unavailable' for an empty array.
 */
export function worstFreshness(states: FreshnessState[]): FreshnessState {
  if (states.length === 0) return 'unavailable'
  return states.reduce<FreshnessState>(
    (worst, s) => FRESHNESS_RANK[s] > FRESHNESS_RANK[worst] ? s : worst,
    'fresh',
  )
}
