import { api } from '../api/client'

/**
 * Shared in-flight promise for SSE token requests across all stream
 * hooks (events, signals, telemetry).
 *
 * Audit P3 (2026-04-29): each stream hook (`useEventSource`,
 * `useSignalStream`, `useTelemetryStream`) was independently calling
 * `POST /api/sse_token` during reconnect. Under network jitter or
 * focus-based reconnection, two streams could request tokens within
 * a few ms of each other, causing the backend to mint two tokens,
 * the second of which superseded/expired the first. Result: extra
 * latency on reconnect (~1.5s for the back-off retry) and wasted
 * load on the rate-limit bucket.
 *
 * This module wraps the token fetch in a promise-keyed cache: while
 * a request is in flight, all subsequent callers within the same
 * window await the SAME promise. Once the promise settles (success
 * or failure), the cache clears so the next caller starts fresh.
 *
 * The cached window is intentionally narrow: the goal is just to
 * coalesce simultaneous reconnect bursts, not to share long-lived
 * tokens across hooks. Each token has a 60s TTL on the backend; if
 * a hook reconnects after that window, it gets a fresh token via a
 * fresh in-flight cycle.
 */

interface SseTokenResponse {
  token: string
  expires_in: number
}

let inFlight: Promise<SseTokenResponse> | null = null

export function fetchSseToken(): Promise<SseTokenResponse> {
  if (inFlight) return inFlight

  const promise = api.post<SseTokenResponse>('/api/sse_token', {})
    .finally(() => {
      // Clear the cache exactly when this promise settles. A subsequent
      // caller that arrives AFTER settlement gets a fresh token request
      // (correct — tokens are short-lived and per-connection).
      if (inFlight === promise) inFlight = null
    })

  inFlight = promise
  return promise
}

// Test-only escape hatch: exposed so unit tests can reset between
// cases without coupling to the module's internal state. Production
// code never calls this.
export function __resetSseTokenCacheForTests(): void {
  inFlight = null
}
