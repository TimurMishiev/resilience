import type { Signal } from '../api/types'

// Deterministic pseudo-random signal generator used exclusively by the
// map-scale benchmark (see e2e/map-scale-benchmark.spec.ts).  Gated at the
// MapPage entry by localStorage.resilience.perf === '1' AND
// localStorage.resilience.perf.bench_signal_count.  Never runs in production.
//
// We bypass /api/signals (which caps per_page at 200) and feed a synthetic
// array directly into the `signals` prop so reconcile cost in
// useMapSignalLayers can be characterized at 1k / 10k / 100k without
// touching prod pagination, DB seeds, or the live pipeline.

const BASE_OCCURRED_AT_MS = Date.parse('2026-04-18T00:00:00Z')

// Linear congruential generator — Numerical Recipes constants.  We keep this
// inline rather than pulling a dep because the benchmark only needs
// reproducibility, not statistical quality.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

export function buildSyntheticBenchSignals(count: number): Signal[] {
  const rng = seededRandom(0xC0FFEE)
  const signals: Signal[] = new Array(count)
  for (let i = 0; i < count; i += 1) {
    const lat = -60 + rng() * 120
    const lng = -180 + rng() * 360
    const occurredAt = new Date(BASE_OCCURRED_AT_MS + i * 1000).toISOString()
    signals[i] = {
      id:          `bench-sig-${i.toString().padStart(6, '0')}`,
      source:      'ais',
      signal_type: 'vessel_position',
      external_id: `BENCH-AIS-${i.toString().padStart(6, '0')}`,
      lat,
      lng,
      altitude:    null,
      speed:       null,
      heading:     null,
      magnitude:   null,
      raw_payload: {},
      occurred_at: occurredAt,
      ingested_at: occurredAt,
    }
  }
  return signals
}

export function readBenchSignalCount(): number | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem('resilience.perf.bench_signal_count')
  if (!raw) return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.floor(parsed)
}
