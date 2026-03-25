import { test, expect } from '@playwright/test'
import { primeAuthenticatedSession } from './helpers'
type PerfEvent = {
  name: string
  durationMs?: number
  details: Record<string, unknown>
}

type GlobeBenchmarkTarget = {
  siteId: string
  siteName: string
  focusedSignalCount: number
  globalSignalCount: number
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

test('benchmark focused-to-global globe signal reconcile', async ({ page }, testInfo) => {
  await primeAuthenticatedSession(page)
  await page.addInitScript(() => {
    window.localStorage.setItem('resilience.perf', '1')
    window.localStorage.removeItem('resilience.perf.debug')
  })

  await page.goto('/globe')

  await page.waitForFunction(() => Boolean((window as Window & { __resilienceGlobeBench?: unknown }).__resilienceGlobeBench))
  await page.waitForFunction(() => {
    const bench = (window as Window & { __resilienceGlobeBench?: { getState: () => { viewerReady: boolean; siteCount: number; signalCount: number; benchmarkTarget: unknown } } }).__resilienceGlobeBench
    if (!bench) return false
    const state = bench.getState()
    return state.viewerReady && state.siteCount > 0 && state.signalCount > 0 && state.benchmarkTarget !== null
  })

  const benchmarkTarget = await page.evaluate(() => {
    const bench = (window as Window & { __resilienceGlobeBench?: { getBenchmarkTarget: () => GlobeBenchmarkTarget | null } }).__resilienceGlobeBench
    return bench?.getBenchmarkTarget() ?? null
  })

  expect(benchmarkTarget).not.toBeNull()

  const target = benchmarkTarget as GlobeBenchmarkTarget
  const durations: number[] = []
  const deltas: number[] = []

  for (let i = 0; i < 5; i += 1) {
    await page.evaluate((siteId) => {
      const bench = (window as Window & { __resilienceGlobeBench?: { clearPerf: () => void; focusSite: (id: string) => boolean } }).__resilienceGlobeBench
      bench?.clearPerf()
      bench?.focusSite(siteId)
    }, target.siteId)

    await page.waitForFunction((siteId) => {
      const bench = (window as Window & { __resilienceGlobeBench?: { getState: () => { selectedSiteId: string | null } } }).__resilienceGlobeBench
      return bench?.getState().selectedSiteId === siteId
    }, target.siteId)

    await page.waitForFunction(() => {
      const bench = (window as Window & { __resilienceGlobeBench?: { getPerfEvents: () => PerfEvent[] } }).__resilienceGlobeBench
      return (bench?.getPerfEvents() ?? []).some(
        event => event.name === 'globe.signal_reconcile' && event.details.transition === 'global_to_focused',
      )
    })

    await page.evaluate(() => {
      const bench = (window as Window & { __resilienceGlobeBench?: { clearPerf: () => void; clearSelection: () => void; flyHome: () => void } }).__resilienceGlobeBench
      bench?.clearPerf()
      bench?.clearSelection()
      bench?.flyHome()
    })

    await page.waitForFunction(() => {
      const bench = (window as Window & { __resilienceGlobeBench?: { getState: () => { selectedSiteId: string | null } } }).__resilienceGlobeBench
      return bench?.getState().selectedSiteId === null
    })

    const eventHandle = await page.waitForFunction(() => {
      const bench = (window as Window & { __resilienceGlobeBench?: { getPerfEvents: () => PerfEvent[] } }).__resilienceGlobeBench
      return (bench?.getPerfEvents() ?? []).find(
        event => event.name === 'globe.signal_reconcile' && event.details.transition === 'focused_to_global',
      ) ?? null
    })

    const event = await eventHandle.jsonValue() as PerfEvent
    durations.push(Number(event.durationMs ?? 0))
    deltas.push(Number(event.details.focusedSignalCountDelta ?? 0))
  }

  const summary = {
    benchmarkTarget: target,
    samples: durations.length,
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
    meanMs: mean(durations),
    p95Ms: percentile(durations, 95),
    maxSignalDelta: Math.max(...deltas),
  }

  await testInfo.attach('globe-benchmark-summary', {
    body: Buffer.from(JSON.stringify(summary, null, 2)),
    contentType: 'application/json',
  })

  console.log(`globe-benchmark ${JSON.stringify(summary)}`)

  expect(durations.length).toBe(5)
  expect(summary.maxSignalDelta).toBeGreaterThan(0)
})
