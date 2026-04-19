import type { Site } from '../../api/types'

// Map's signal-layer reconcile is not site-scoped — it rebuilds every signal
// source regardless of selection — so there is no meaningful "signals near
// focus" number to report. The globe bench target carries `focusedSignalCount`
// because its benchmark picks a site with a small 2000km-local subset; that
// intentionally does not apply here.
export type MapBenchmarkTarget = {
  siteId:             string
  siteName:           string
  globalSignalCount:  number
}

export type MapBenchmarkState = {
  mapLoaded:        boolean
  siteCount:        number
  signalCount:      number
  selectedSiteId:   string | null
  selectedAssetId:  string | null
  selectedSignalId: string | null
  showSignals:      boolean
  showHeatmap:      boolean
  showCoverage:     boolean
  benchmarkTarget:  MapBenchmarkTarget | null
}

export type MapBenchmarkApi = {
  getState:            () => MapBenchmarkState
  getBenchmarkTarget:  () => MapBenchmarkTarget | null
  getSites:            () => Site[]
  focusSite:           (siteId: string) => boolean
  focusBenchmarkSite:  () => MapBenchmarkTarget | null
  clearSelection:      () => void
  clearPerf:           () => void
  getPerfEvents:       () => unknown[]
}

declare global {
  interface Window {
    __resilienceMapBench?: MapBenchmarkApi
  }
}
