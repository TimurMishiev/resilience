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

// Initial budgets are intentionally loose — 6-1B just needs a passing spec.
// 6-1C establishes a baseline on real data and tightens these, and wires
// CI to fail on regression. Override per-env via MAP_BENCH_MAX_MEAN_MS /
// MAP_BENCH_MAX_P95_MS / MAP_BENCH_MAX_SINGLE_SAMPLE_MS if needed.
const DEFAULT_MAX_MEAN_MS = 15
const DEFAULT_MAX_P95_MS = 30
const DEFAULT_MAX_SINGLE_SAMPLE_MS = 50

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

test('benchmark map signal-reconcile on selection set/clear', async ({ page }, testInfo) => {
  // MapLibre cold-start under swiftshader plus seeded data fetch can be slow
  // on shared CI runners.  The reconcile itself is JS-only (see
  // frontend/src/hooks/map/useMapSignalLayers.ts:55-83 — it manipulates
  // GeoJSON source data, not the GL canvas) so the samples measured below
  // are typically sub-millisecond; the extra timeout covers setup only.
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
  const selectionSetDurations: number[] = []
  const selectionClearedDurations: number[] = []

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
    selectionSetDurations.push(Number(selectionSetEvent.durationMs ?? 0))

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
    selectionClearedDurations.push(Number(selectionClearedEvent.durationMs ?? 0))
  }

  const allDurations = [...selectionSetDurations, ...selectionClearedDurations]

  const summary = {
    benchmarkTarget: target,
    samples: allDurations.length,
    selectionSet: {
      samples: selectionSetDurations.length,
      minMs: Math.min(...selectionSetDurations),
      maxMs: Math.max(...selectionSetDurations),
      meanMs: mean(selectionSetDurations),
      p95Ms: percentile(selectionSetDurations, 95),
    },
    selectionCleared: {
      samples: selectionClearedDurations.length,
      minMs: Math.min(...selectionClearedDurations),
      maxMs: Math.max(...selectionClearedDurations),
      meanMs: mean(selectionClearedDurations),
      p95Ms: percentile(selectionClearedDurations, 95),
    },
    combined: {
      minMs: Math.min(...allDurations),
      maxMs: Math.max(...allDurations),
      meanMs: mean(allDurations),
      p95Ms: percentile(allDurations, 95),
    },
  }

  const maxMeanMs = readBudget('MAP_BENCH_MAX_MEAN_MS', DEFAULT_MAX_MEAN_MS)
  const maxP95Ms = readBudget('MAP_BENCH_MAX_P95_MS', DEFAULT_MAX_P95_MS)
  const maxSingleSampleMs = readBudget('MAP_BENCH_MAX_SINGLE_SAMPLE_MS', DEFAULT_MAX_SINGLE_SAMPLE_MS)

  await testInfo.attach('map-benchmark-summary', {
    body: Buffer.from(JSON.stringify({
      ...summary,
      budgets: {
        maxMeanMs,
        maxP95Ms,
        maxSingleSampleMs,
      },
    }, null, 2)),
    contentType: 'application/json',
  })

  console.log(`map-benchmark ${JSON.stringify({
    ...summary,
    budgets: {
      maxMeanMs,
      maxP95Ms,
      maxSingleSampleMs,
    },
  })}`)

  expect(selectionSetDurations.length).toBe(5)
  expect(selectionClearedDurations.length).toBe(5)
  expect(summary.combined.meanMs).toBeLessThanOrEqual(maxMeanMs)
  expect(summary.combined.p95Ms).toBeLessThanOrEqual(maxP95Ms)
  expect(summary.combined.maxMs).toBeLessThanOrEqual(maxSingleSampleMs)
})
