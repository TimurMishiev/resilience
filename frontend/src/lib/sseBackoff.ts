export const SSE_RETRY_RESET_DELAY_MS = 1_000
export const SSE_RETRY_FLOOR_MS = 5_000
export const SSE_RETRY_MAX_MS = 30_000

/**
 * Keep failed stream-open retries above a floor so the three live SSE hooks
 * cannot churn fast enough to trip the shared stream-open rate limiter under
 * reconnect storms.
 */
export function currentSseRetryDelayMs(delayMs: number): number {
  return Math.max(delayMs, SSE_RETRY_FLOOR_MS)
}

export function nextSseRetryDelayMs(delayMs: number): number {
  return Math.min(delayMs * 2, SSE_RETRY_MAX_MS)
}
