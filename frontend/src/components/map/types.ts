import type { Site } from '../../api/types'

// The map's `map.signal_reconcile` perf event fires on selectedSignalId
// changes (the deps on useMapSignalLayers' source-data effect are
// [mapLoaded, selectedSignalId, signals, referenceTimeMs, mapRef] —
// see frontend/src/hooks/map/useMapSignalLayers.ts:84). Site selection
// does not re-run the reconcile, so the benchmark target is signal-shaped,
// not site-shaped. The globe analog is site-shaped because the globe
// reconcile filters signals to a 2000km-local subset of the selected site.
export type MapBenchmarkTarget = {
  signalId:           string
  signalType:         string
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
  getState:              () => MapBenchmarkState
  getBenchmarkTarget:    () => MapBenchmarkTarget | null
  getSites:              () => Site[]
  focusSite:             (siteId: string) => boolean
  focusBenchmarkSignal:  () => MapBenchmarkTarget | null
  clearSelection:        () => void
  clearPerf:             () => void
  getPerfEvents:         () => unknown[]
}

declare global {
  interface Window {
    __resilienceMapBench?: MapBenchmarkApi
  }
}
