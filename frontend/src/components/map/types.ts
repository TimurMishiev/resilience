import type { Site } from '../../api/types'

export type MapBenchmarkTarget = {
  siteId:               string
  siteName:             string
  signalCountAtFocus:   number
  globalSignalCount:    number
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
