type PerfEventName =
  | 'globe.signal_reconcile'
  | 'globe.signal_visibility'
  | 'globe.pick'

type PerfEvent = {
  name: PerfEventName
  recordedAt: string
  durationMs?: number
  details: Record<string, unknown>
}

type PerfStore = {
  events: PerfEvent[]
  clear: () => void
}

const PERF_STORAGE_KEY = 'resilience.perf'
const PERF_DEBUG_STORAGE_KEY = 'resilience.perf.debug'
const PERF_EVENT_LIMIT = 200

declare global {
  interface Window {
    __resiliencePerf?: PerfStore
  }
}

function isPerfEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(PERF_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function isPerfDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(PERF_DEBUG_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function getPerfStore(): PerfStore {
  if (!window.__resiliencePerf) {
    window.__resiliencePerf = {
      events: [],
      clear() {
        this.events.length = 0
      },
    }
  }
  return window.__resiliencePerf
}

export function recordPerfEvent(
  name: PerfEventName,
  details: Record<string, unknown>,
  durationMs?: number,
) {
  if (typeof window === 'undefined' || !isPerfEnabled()) return

  const store = getPerfStore()
  const event: PerfEvent = {
    name,
    recordedAt: new Date().toISOString(),
    ...(durationMs != null ? { durationMs } : {}),
    details,
  }

  store.events.push(event)
  if (store.events.length > PERF_EVENT_LIMIT) {
    store.events.splice(0, store.events.length - PERF_EVENT_LIMIT)
  }

  window.dispatchEvent(new CustomEvent('resilience:perf', { detail: event }))

  if (import.meta.env.DEV && isPerfDebugEnabled()) {
    console.debug(`[perf] ${name}`, event)
  }
}

export function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}
