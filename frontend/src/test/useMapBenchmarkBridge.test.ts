import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMapBenchmarkBridge } from '../hooks/useMapBenchmarkBridge'
import type { MapBenchmarkState } from '../components/map/types'
import type { Site } from '../api/types'

function buildState(overrides: Partial<MapBenchmarkState> = {}): MapBenchmarkState {
  return {
    mapLoaded: true,
    siteCount: 2,
    signalCount: 3,
    selectedSiteId: null,
    selectedAssetId: null,
    selectedSignalId: null,
    showSignals: true,
    showHeatmap: false,
    showCoverage: true,
    benchmarkTarget: { siteId: 'site-1', siteName: 'Site Alpha', globalSignalCount: 3 },
    ...overrides,
  }
}

function buildSites(): Site[] {
  return [
    { id: 'site-1', name: 'Site Alpha', latitude: 1, longitude: 2, status: 'active', geofence_radius_km: 0 } as Site,
    { id: 'site-2', name: 'Site Beta',  latitude: 3, longitude: 4, status: 'active', geofence_radius_km: 0 } as Site,
  ]
}

describe('useMapBenchmarkBridge', () => {
  let setSelectedSiteId: ReturnType<typeof vi.fn>
  let setSelectedAssetId: ReturnType<typeof vi.fn>
  let setSelectedSignalId: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setSelectedSiteId = vi.fn()
    setSelectedAssetId = vi.fn()
    setSelectedSignalId = vi.fn()
    delete window.__resilienceMapBench
    delete window.__resiliencePerf
  })

  afterEach(() => {
    delete window.__resilienceMapBench
    delete window.__resiliencePerf
  })

  it('does not attach a bridge when perf is disabled', () => {
    const stateRef = { current: buildState() }
    const sitesRef = { current: buildSites() }
    renderHook(() => useMapBenchmarkBridge({
      perfEnabled: false,
      stateRef, sitesRef,
      setSelectedSiteId, setSelectedAssetId, setSelectedSignalId,
    }))
    expect(window.__resilienceMapBench).toBeUndefined()
  })

  it('attaches the bridge when perf is enabled and exposes current state', () => {
    const stateRef = { current: buildState({ selectedSiteId: 'site-2' }) }
    const sitesRef = { current: buildSites() }
    renderHook(() => useMapBenchmarkBridge({
      perfEnabled: true,
      stateRef, sitesRef,
      setSelectedSiteId, setSelectedAssetId, setSelectedSignalId,
    }))
    const bench = window.__resilienceMapBench
    expect(bench).toBeDefined()
    expect(bench?.getState().selectedSiteId).toBe('site-2')
    expect(bench?.getState().siteCount).toBe(2)
    expect(bench?.getBenchmarkTarget()).toEqual({
      siteId: 'site-1', siteName: 'Site Alpha', globalSignalCount: 3,
    })
    expect(bench?.getSites().map(s => s.id)).toEqual(['site-1', 'site-2'])
  })

  it('focusSite returns false for unknown ids and does not mutate selection', () => {
    const stateRef = { current: buildState() }
    const sitesRef = { current: buildSites() }
    renderHook(() => useMapBenchmarkBridge({
      perfEnabled: true,
      stateRef, sitesRef,
      setSelectedSiteId, setSelectedAssetId, setSelectedSignalId,
    }))
    const bench = window.__resilienceMapBench!
    expect(bench.focusSite('site-missing')).toBe(false)
    expect(setSelectedSiteId).not.toHaveBeenCalled()
  })

  it('focusSite drives selection setters and clears asset/signal selection', () => {
    const stateRef = { current: buildState() }
    const sitesRef = { current: buildSites() }
    renderHook(() => useMapBenchmarkBridge({
      perfEnabled: true,
      stateRef, sitesRef,
      setSelectedSiteId, setSelectedAssetId, setSelectedSignalId,
    }))
    const bench = window.__resilienceMapBench!
    expect(bench.focusSite('site-2')).toBe(true)
    expect(setSelectedSiteId).toHaveBeenCalledWith('site-2')
    expect(setSelectedAssetId).toHaveBeenCalledWith(null)
    expect(setSelectedSignalId).toHaveBeenCalledWith(null)
  })

  it('focusBenchmarkSite resolves the recommended target and drives selection', () => {
    const stateRef = { current: buildState() }
    const sitesRef = { current: buildSites() }
    renderHook(() => useMapBenchmarkBridge({
      perfEnabled: true,
      stateRef, sitesRef,
      setSelectedSiteId, setSelectedAssetId, setSelectedSignalId,
    }))
    const bench = window.__resilienceMapBench!
    const target = bench.focusBenchmarkSite()
    expect(target?.siteId).toBe('site-1')
    expect(setSelectedSiteId).toHaveBeenCalledWith('site-1')
  })

  it('focusBenchmarkSite returns null when no target is available', () => {
    const stateRef = { current: buildState({ benchmarkTarget: null }) }
    const sitesRef = { current: [] }
    renderHook(() => useMapBenchmarkBridge({
      perfEnabled: true,
      stateRef, sitesRef,
      setSelectedSiteId, setSelectedAssetId, setSelectedSignalId,
    }))
    expect(window.__resilienceMapBench!.focusBenchmarkSite()).toBeNull()
    expect(setSelectedSiteId).not.toHaveBeenCalled()
  })

  it('clearSelection sets all three selection slots to null', () => {
    const stateRef = { current: buildState() }
    const sitesRef = { current: buildSites() }
    renderHook(() => useMapBenchmarkBridge({
      perfEnabled: true,
      stateRef, sitesRef,
      setSelectedSiteId, setSelectedAssetId, setSelectedSignalId,
    }))
    window.__resilienceMapBench!.clearSelection()
    expect(setSelectedSiteId).toHaveBeenCalledWith(null)
    expect(setSelectedAssetId).toHaveBeenCalledWith(null)
    expect(setSelectedSignalId).toHaveBeenCalledWith(null)
  })

  it('proxies clearPerf and getPerfEvents to the global perf store', () => {
    const events = [{ name: 'map.signal_reconcile' as const, recordedAt: 'x', details: {} }]
    const clear = vi.fn()
    window.__resiliencePerf = { events, clear }
    const stateRef = { current: buildState() }
    const sitesRef = { current: buildSites() }
    renderHook(() => useMapBenchmarkBridge({
      perfEnabled: true,
      stateRef, sitesRef,
      setSelectedSiteId, setSelectedAssetId, setSelectedSignalId,
    }))
    const bench = window.__resilienceMapBench!
    expect(bench.getPerfEvents()).toEqual(events)
    bench.clearPerf()
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('detaches the bridge when perfEnabled flips back to false', () => {
    const stateRef = { current: buildState() }
    const sitesRef = { current: buildSites() }
    const { rerender } = renderHook(({ perfEnabled }: { perfEnabled: boolean }) => useMapBenchmarkBridge({
      perfEnabled,
      stateRef, sitesRef,
      setSelectedSiteId, setSelectedAssetId, setSelectedSignalId,
    }), { initialProps: { perfEnabled: true } })

    expect(window.__resilienceMapBench).toBeDefined()
    rerender({ perfEnabled: false })
    expect(window.__resilienceMapBench).toBeUndefined()
  })

  it('detaches the bridge on unmount', () => {
    const stateRef = { current: buildState() }
    const sitesRef = { current: buildSites() }
    const { unmount } = renderHook(() => useMapBenchmarkBridge({
      perfEnabled: true,
      stateRef, sitesRef,
      setSelectedSiteId, setSelectedAssetId, setSelectedSignalId,
    }))
    expect(window.__resilienceMapBench).toBeDefined()
    unmount()
    expect(window.__resilienceMapBench).toBeUndefined()
  })
})
