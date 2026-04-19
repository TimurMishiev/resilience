import { test, expect } from '@playwright/test'
import { primeAuthenticatedSession } from './helpers'

type PerfEvent = {
  name: string
  durationMs?: number
  details: Record<string, unknown>
}

type MapBenchmarkTarget = {
  signalId: string
  signalType: string
  globalSignalCount: number
}

// The CI gate asserts on jsMs — the deterministic synchronous reconcile cost
// in `useMapSignalLayers` — because paintMs (the full rAF→paint→commit cycle)
// is dominated by swiftshader software rasterization on CI and has too much
// variance (100–1400ms across 5 local baseline runs) to gate on reliably.
// jsMs at the seeded 315-signal dataset is sub-3ms; paintMs is still captured
// and reported for observability / local-GPU comparison.
//
// 6-1C baseline across 5 local runs (Apple M-series, swiftshader):
//   jsMs combined  — mean 2.0ms, p95 2.5ms, max 2.5ms
//   paintMs combined — mean 261–410ms, max up to 1444ms (swiftshader-bound)
//
// Budgets are 2.5× mean / 2.5× p95 / 3× max of the baseline, with 15/30/50ms
// floors so a faster-than-expected machine or future optimization doesn't
// silently ratchet the gate below the historical 6-1B defaults (which are a
// practical noise floor for cross-runner variance).  The floors currently
// win — raise the multiplier numbers ahead of the floor only once a tighter
// baseline has been demonstrated to hold across multiple CI runs.
//
// Override per-env via MAP_BENCH_MAX_JS_MEAN_MS / MAP_BENCH_MAX_JS_P95_MS /
// MAP_BENCH_MAX_JS_SINGLE_SAMPLE_MS.
const DEFAULT_MAX_JS_MEAN_MS = 15
const DEFAULT_MAX_JS_P95_MS = 30
const DEFAULT_MAX_JS_SINGLE_SAMPLE_MS = 50

function readBudget(envKey: string, fallback: number): number {
  const raw = process.env[envKey]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(values: number[], percentileRank: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileRank / 100) * sorted.length) - 1))
  return sorted[index]
}

type SampleStats = {
  samples: number
  minMs: number
  maxMs: number
  meanMs: number
  p95Ms: number
}

function summarize(values: number[]): SampleStats {
  return {
    samples: values.length,
    minMs: values.length ? Math.min(...values) : 0,
    maxMs: values.length ? Math.max(...values) : 0,
    meanMs: mean(values),
    p95Ms: percentile(values, 95),
  }
}

test('benchmark map signal-reconcile on selection set/clear', async ({ page }, testInfo) => {
  // MapLibre cold-start under swiftshader plus seeded data fetch can be slow
  // on shared CI runners.  The reconcile itself is JS-only (see
  // frontend/src/hooks/map/useMapSignalLayers.ts — it manipulates GeoJSON
  // source data, not the GL canvas) so jsMs is sub-5ms; the extra timeout
  // covers setup and paint-completion rAF waits only.
  test.setTimeout(180_000)

  await primeAuthenticatedSession(page)
  await page.addInitScript(() => {
    window.localStorage.setItem('resilience.perf', '1')
    window.localStorage.removeItem('resilience.perf.debug')
  })

  await page.goto('/map')

  await page.waitForFunction(() => Boolean((window as Window & { __resilienceMapBench?: unknown }).__resilienceMapBench))
  await page.waitForFunction(() => {
    const bench = (window as Window & { __resilienceMapBench?: { getState: () => { mapLoaded: boolean; signalCount: number; benchmarkTarget: unknown } } }).__resilienceMapBench
    if (!bench) return false
    const state = bench.getState()
    return state.mapLoaded && state.signalCount > 0 && state.benchmarkTarget !== null
  })

  const benchmarkTarget = await page.evaluate(() => {
    const bench = (window as Window & { __resilienceMapBench?: { getBenchmarkTarget: () => MapBenchmarkTarget | null } }).__resilienceMapBench
    return bench?.getBenchmarkTarget() ?? null
  })

  expect(benchmarkTarget).not.toBeNull()

  const target = benchmarkTarget as MapBenchmarkTarget
  const selectionSetJs: number[] = []
  const selectionSetPaint: number[] = []
  const selectionClearedJs: number[] = []
  const selectionClearedPaint: number[] = []

  for (let i = 0; i < 5; i += 1) {
    await page.evaluate(() => {
      const bench = (window as Window & { __resilienceMapBench?: { clearPerf: () => void; focusBenchmarkSignal: () => unknown } }).__resilienceMapBench
      bench?.clearPerf()
      bench?.focusBenchmarkSignal()
    })

    const selectionSetHandle = await page.waitForFunction(() => {
      const bench = (window as Window & { __resilienceMapBench?: { getPerfEvents: () => PerfEvent[] } }).__resilienceMapBench
      return (bench?.getPerfEvents() ?? []).find(
        event => event.name === 'map.signal_reconcile' && event.details.trigger === 'selection_set',
      ) ?? null
    })

    const selectionSetEvent = await selectionSetHandle.jsonValue() as PerfEvent
    selectionSetJs.push(Number((selectionSetEvent.details as { jsMs?: unknown }).jsMs ?? 0))
    selectionSetPaint.push(Number(selectionSetEvent.durationMs ?? 0))

    await page.evaluate(() => {
      const bench = (window as Window & { __resilienceMapBench?: { clearPerf: () => void; clearSelection: () => void } }).__resilienceMapBench
      bench?.clearPerf()
      bench?.clearSelection()
    })

    const selectionClearedHandle = await page.waitForFunction(() => {
      const bench = (window as Window & { __resilienceMapBench?: { getPerfEvents: () => PerfEvent[] } }).__resilienceMapBench
      return (bench?.getPerfEvents() ?? []).find(
        event => event.name === 'map.signal_reconcile' && event.details.trigger === 'selection_cleared',
      ) ?? null
    })

    const selectionClearedEvent = await selectionClearedHandle.jsonValue() as PerfEvent
    selectionClearedJs.push(Number((selectionClearedEvent.details as { jsMs?: unknown }).jsMs ?? 0))
    selectionClearedPaint.push(Number(selectionClearedEvent.durationMs ?? 0))
  }

  const allJs = [...selectionSetJs, ...selectionClearedJs]
  const allPaint = [...selectionSetPaint, ...selectionClearedPaint]

  const summary = {
    benchmarkTarget: target,
    samples: allJs.length,
    jsMs: {
      selectionSet:     summarize(selectionSetJs),
      selectionCleared: summarize(selectionClearedJs),
      combined:         summarize(allJs),
    },
    paintMs: {
      selectionSet:     summarize(selectionSetPaint),
      selectionCleared: summarize(selectionClearedPaint),
      combined:         summarize(allPaint),
    },
  }

  const maxJsMeanMs         = readBudget('MAP_BENCH_MAX_JS_MEAN_MS',          DEFAULT_MAX_JS_MEAN_MS)
  const maxJsP95Ms          = readBudget('MAP_BENCH_MAX_JS_P95_MS',           DEFAULT_MAX_JS_P95_MS)
  const maxJsSingleSampleMs = readBudget('MAP_BENCH_MAX_JS_SINGLE_SAMPLE_MS', DEFAULT_MAX_JS_SINGLE_SAMPLE_MS)

  const report = {
    ...summary,
    budgets: {
      maxJsMeanMs,
      maxJsP95Ms,
      maxJsSingleSampleMs,
    },
  }

  await testInfo.attach('map-benchmark-summary', {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: 'application/json',
  })

  console.log(`map-benchmark ${JSON.stringify(report)}`)

  expect(selectionSetJs.length).toBe(5)
  expect(selectionClearedJs.length).toBe(5)
  expect(summary.jsMs.combined.meanMs).toBeLessThanOrEqual(maxJsMeanMs)
  expect(summary.jsMs.combined.p95Ms).toBeLessThanOrEqual(maxJsP95Ms)
  expect(summary.jsMs.combined.maxMs).toBeLessThanOrEqual(maxJsSingleSampleMs)
})
