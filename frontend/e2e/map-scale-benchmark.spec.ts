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

// Scale characterization for useMapSignalLayers reconcile cost.
//
// Unlike e2e/map-benchmark.spec.ts (which drives the real /api/signals
// pipeline at the seeded ~315 signal count), this spec bypasses /api/signals
// entirely: MapPage reads localStorage.resilience.perf.bench_signal_count and
// feeds a synthetic Signal[] of that size straight into the reconcile hook
// (see frontend/src/lib/benchSyntheticSignals.ts).  This isolates
// JS-only reconcile cost from backend pagination (capped at per_page=200) and
// from DB seed size, letting us characterize 1k / 10k / 100k deterministically
// on any runner.
//
// No CI budget gates here — this spec is a characterization tool, not a gate.
// First real run is the baseline.  6-1E will decide CI wiring (likely a
// report-only attachment with a per-tier budget added only if variance is
// tight enough to gate on).

type Tier = { label: string; count: number }

const DEFAULT_TIERS: Tier[] = [
  { label: '1k',   count: 1_000 },
  { label: '10k',  count: 10_000 },
  { label: '100k', count: 100_000 },
]

function parseTiers(raw: string | undefined): Tier[] {
  if (!raw) return DEFAULT_TIERS
  const parsed = raw.split(',').map(part => {
    const n = Number(part.trim())
    if (!Number.isFinite(n) || n <= 0) return null
    return { label: `${n}`, count: Math.floor(n) }
  }).filter((t): t is Tier => t !== null)
  return parsed.length > 0 ? parsed : DEFAULT_TIERS
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

function summarize(values: number[]) {
  return {
    samples: values.length,
    minMs:   values.length ? Math.min(...values) : 0,
    maxMs:   values.length ? Math.max(...values) : 0,
    meanMs:  mean(values),
    p95Ms:   percentile(values, 95),
  }
}

const SAMPLE_CYCLES = Number(process.env['MAP_SCALE_BENCH_CYCLES']) > 0
  ? Math.floor(Number(process.env['MAP_SCALE_BENCH_CYCLES']))
  : 5

const TIERS = parseTiers(process.env['MAP_SCALE_BENCH_TIERS'])

for (const tier of TIERS) {
  test(`map scale benchmark — ${tier.label} synthetic signals`, async ({ page }, testInfo) => {
    // 100k synthetic signals + first reconcile + MapLibre cold start under
    // swiftshader can legitimately take >1m on shared runners.  jsMs itself
    // is fast; this timeout covers setup + paint-completion rAF waits only.
    test.setTimeout(300_000)

    await primeAuthenticatedSession(page)
    await page.addInitScript((count: number) => {
      window.localStorage.setItem('resilience.perf', '1')
      window.localStorage.removeItem('resilience.perf.debug')
      window.localStorage.setItem('resilience.perf.bench_signal_count', String(count))
    }, tier.count)

    await page.goto('/map')

    await page.waitForFunction(() => Boolean((window as Window & { __resilienceMapBench?: unknown }).__resilienceMapBench))
    await page.waitForFunction(expectedCount => {
      const bench = (window as Window & { __resilienceMapBench?: { getState: () => { mapLoaded: boolean; signalCount: number; benchmarkTarget: unknown } } }).__resilienceMapBench
      if (!bench) return false
      const state = bench.getState()
      return state.mapLoaded && state.signalCount === expectedCount && state.benchmarkTarget !== null
    }, tier.count)

    const benchmarkTarget = await page.evaluate(() => {
      const bench = (window as Window & { __resilienceMapBench?: { getBenchmarkTarget: () => MapBenchmarkTarget | null } }).__resilienceMapBench
      return bench?.getBenchmarkTarget() ?? null
    })
    expect(benchmarkTarget).not.toBeNull()
    const target = benchmarkTarget as MapBenchmarkTarget
    expect(target.globalSignalCount).toBe(tier.count)

    const selectionSetJs: number[] = []
    const selectionSetPaint: number[] = []
    const selectionClearedJs: number[] = []
    const selectionClearedPaint: number[] = []

    for (let i = 0; i < SAMPLE_CYCLES; i += 1) {
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

    const report = {
      tier: tier.label,
      signalCount: tier.count,
      samples: selectionSetJs.length + selectionClearedJs.length,
      jsMs: {
        selectionSet:     summarize(selectionSetJs),
        selectionCleared: summarize(selectionClearedJs),
        combined:         summarize([...selectionSetJs, ...selectionClearedJs]),
      },
      paintMs: {
        selectionSet:     summarize(selectionSetPaint),
        selectionCleared: summarize(selectionClearedPaint),
        combined:         summarize([...selectionSetPaint, ...selectionClearedPaint]),
      },
    }

    await testInfo.attach(`map-scale-benchmark-${tier.label}`, {
      body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: 'application/json',
    })

    console.log(`map-scale-benchmark ${JSON.stringify(report)}`)

    expect(selectionSetJs.length).toBe(SAMPLE_CYCLES)
    expect(selectionClearedJs.length).toBe(SAMPLE_CYCLES)
  })
}
