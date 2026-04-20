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
// Per-tier gates are driven by the 6-1E.a baseline (5 local runs × 50 samples
// per tier per metric, recorded in memory/execution_handoff.md):
//   1k:   gate jsMs mean / p95 / max — all stable across runs.  budgets
//         (15/25/30ms) sit ~2.5× over local ceilings (mean 6.6 / p95 12.2 /
//         max 12.2) to absorb runner noise.
//   10k:  gate jsMs p95 + max only.  combined-mean is volatile because
//         `selection_cleared` paint-coalesces below 3ms; one of 5 runs drifted
//         to 8.46ms vs ~48.7ms baseline.  per-run p95 spread is 1.6% locally,
//         but ubuntu-latest is noisier than local: budgets (120/150ms) give
//         ~2× headroom over the 58.6ms local p95 ceiling so first CI runs do
//         not flake.  re-anchor via env override once a real runner baseline
//         exists.
//   100k: report-only.  per-run p95 spans 32.6 → 646.7ms; gating would need
//         ~15× headroom and defeat the purpose.  attached JSON makes
//         regressions visible in the frontend-perf-report artifact.
// paintMs stays report-only at all tiers — swiftshader noise dominates
// (1k tier paintMs p95 of 2306ms exceeds 100k paintMs p95).
//
// Each gateable budget has an env override so CI can re-anchor to runner
// numbers without code changes.  Custom tiers supplied via MAP_SCALE_BENCH_TIERS
// (e.g. "5000,50000") are not in DEFAULT_BUDGETS, so they fall through to
// all-null = report-only unless their budgets are explicitly set via
// MAP_SCALE_BENCH_<LABEL>_MAX_JS_{MEAN,P95,MAX}_MS envars.

type Tier = { label: string; count: number }

type TierBudget = {
  maxJsMeanMs: number | null
  maxJsP95Ms:  number | null
  maxJsMaxMs:  number | null
}

const DEFAULT_TIERS: Tier[] = [
  { label: '1k',   count: 1_000 },
  { label: '10k',  count: 10_000 },
  { label: '100k', count: 100_000 },
]

const DEFAULT_BUDGETS: Record<string, TierBudget> = {
  '1k':   { maxJsMeanMs: 15,   maxJsP95Ms: 25,   maxJsMaxMs: 30   },
  '10k':  { maxJsMeanMs: null, maxJsP95Ms: 120,  maxJsMaxMs: 150  },
  '100k': { maxJsMeanMs: null, maxJsP95Ms: null, maxJsMaxMs: null },
}

function readBudget(envKey: string, fallback: number | null): number | null {
  const raw = process.env[envKey]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function tierBudget(label: string): TierBudget {
  const upper = label.toUpperCase()
  const fallback = DEFAULT_BUDGETS[label] ?? { maxJsMeanMs: null, maxJsP95Ms: null, maxJsMaxMs: null }
  return {
    maxJsMeanMs: readBudget(`MAP_SCALE_BENCH_${upper}_MAX_JS_MEAN_MS`, fallback.maxJsMeanMs),
    maxJsP95Ms:  readBudget(`MAP_SCALE_BENCH_${upper}_MAX_JS_P95_MS`,  fallback.maxJsP95Ms),
    maxJsMaxMs:  readBudget(`MAP_SCALE_BENCH_${upper}_MAX_JS_MAX_MS`,  fallback.maxJsMaxMs),
  }
}

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

    const budget = tierBudget(tier.label)
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
      budgets: budget,
    }

    await testInfo.attach(`map-scale-benchmark-${tier.label}`, {
      body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: 'application/json',
    })

    console.log(`map-scale-benchmark ${JSON.stringify(report)}`)

    expect(selectionSetJs.length).toBe(SAMPLE_CYCLES)
    expect(selectionClearedJs.length).toBe(SAMPLE_CYCLES)

    if (budget.maxJsMeanMs !== null) {
      expect(report.jsMs.combined.meanMs).toBeLessThanOrEqual(budget.maxJsMeanMs)
    }
    if (budget.maxJsP95Ms !== null) {
      expect(report.jsMs.combined.p95Ms).toBeLessThanOrEqual(budget.maxJsP95Ms)
    }
    if (budget.maxJsMaxMs !== null) {
      expect(report.jsMs.combined.maxMs).toBeLessThanOrEqual(budget.maxJsMaxMs)
    }
  })
}
