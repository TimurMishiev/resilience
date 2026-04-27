import { useQuery } from '@tanstack/react-query'
import { getActiveSiteConfidence, type ActiveSiteConfidence } from '../api/signal_rule_matches'
import type { AsOfParam } from '../api/types'

interface ActiveSiteConfidenceOptions {
  enabled?:         boolean
  refetchInterval?: number | false
}

/**
 * Replay scrub advances `as_of` every ~500ms. Without a bucket, every
 * playback tick produces a new query key and refetches the unpaginated
 * summary endpoint (~2 req/sec per client). Confidence summaries don't
 * change at sub-second resolution — alert fires/transitions land on
 * discrete `audit_event` timestamps — so rounding to a coarse window
 * keeps visual fidelity intact while collapsing scrub traffic.
 *
 * 5s is the conservative end of the band: aggressive enough to drop
 * scrub fetches by ~10× while still tracking minute-scale operator
 * narratives. Globe will reuse this same bucket via the same hook.
 */
const REPLAY_AS_OF_BUCKET_MS = 5_000

export function bucketReplayAsOf(asOf: string, bucketMs: number = REPLAY_AS_OF_BUCKET_MS): string {
  const ms = Date.parse(asOf)
  if (Number.isNaN(ms)) return asOf
  const bucketed = Math.floor(ms / bucketMs) * bucketMs
  return new Date(bucketed).toISOString()
}

/**
 * Tranche 6-D-map: replay-aware confidence-halo data feed.
 *
 * Returns the raw backend summary `{ site_id, confidence }` rows from
 * `/api/signal_rule_matches/active_site_confidence`. Unpaginated by design
 * — the endpoint already collapses `site_id -> max(active match confidence)`
 * so this hook intentionally does no further reduction or filtering.
 *
 * Surface-specific concerns (e.g. dropping rows whose site is absent from
 * the current map dataset) belong in the layer hook, not here, so the
 * forthcoming 6-D-globe slice can reuse this same raw feed.
 *
 * Replay-cache strategy: when `as_of` is present, it is rounded down to
 * `REPLAY_AS_OF_BUCKET_MS`. Both the query key and the wire request use
 * the bucketed value so cache hits within the same window genuinely skip
 * the fetch. Live mode (no `as_of`) is unaffected.
 */
export function useActiveSiteConfidence(params?: AsOfParam, options?: ActiveSiteConfidenceOptions) {
  const bucketedParams: AsOfParam | undefined = params?.as_of
    ? { ...params, as_of: bucketReplayAsOf(params.as_of) }
    : params

  return useQuery<{ summaries: ActiveSiteConfidence[] }>({
    queryKey: ['signal_rule_matches', 'active_site_confidence', bucketedParams],
    queryFn:  () => getActiveSiteConfidence(bucketedParams),
    enabled:  options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 10_000,
  })
}
