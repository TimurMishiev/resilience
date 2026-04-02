import type { Asset, Site, Signal } from '../../api/types'
import type { CoverageCircle } from '../../lib/coverage'
import type { TelemetryMap } from '../../lib/telemetry'
import type { GlobeEngineReturn } from '../../hooks/useGlobeEngine'

export type GlobeBenchmarkTarget = {
  siteId: string
  siteName: string
  focusedSignalCount: number
  globalSignalCount: number
}

export type GlobeBenchmarkState = {
  viewerReady: boolean
  siteCount: number
  signalCount: number
  selectedSiteId: string | null
  selectedAssetId: string | null
  selectedSignalId: string | null
  isCloseView: boolean
  showSignals: boolean
  showHeatmap: boolean
  showCoverage: boolean
  benchmarkTarget: GlobeBenchmarkTarget | null
}

export type GlobeBenchmarkApi = {
  getState: () => GlobeBenchmarkState
  getBenchmarkTarget: () => GlobeBenchmarkTarget | null
  focusSite: (siteId: string) => boolean
  focusBestSite: () => GlobeBenchmarkTarget | null
  clearSelection: () => void
  flyHome: () => void
  clearPerf: () => void
  getPerfEvents: () => unknown[]
}

export type GlobeE2ETarget = {
  id: string
  name: string
  latitude: number
  longitude: number
}

export type GlobeE2ECanvasPoint = {
  x: number
  y: number
}

export type GlobeE2EPickResult = {
  outcome: string
  idString?: string
}

export type GlobeE2EApi = {
  getState: () => {
    viewerReady: boolean
    selectedSiteId: string | null
    selectedAssetId: string | null
    selectedSignalId: string | null
    signalCount: number
  }
  getFirstSiteTarget: () => GlobeE2ETarget | null
  getFirstSignalTarget: () => GlobeE2ETarget | null
  getFirstGeofenceTarget: () => GlobeE2ETarget | null
  getFirstCoverageTarget: () => GlobeE2ETarget | null
  projectPosition: (lng: number, lat: number) => GlobeE2ECanvasPoint | null
  projectRenderedPosition: (idString: string) => GlobeE2ECanvasPoint | null
  flyToSite: (siteId: string) => boolean
  flyToAsset: (assetId: string) => boolean
  flyToSignal: (signalId: string) => boolean
  inspectProjectedPosition: (lng: number, lat: number) => GlobeE2EPickResult | null
  pickProjectedPosition: (lng: number, lat: number) => boolean
  pickSiteThroughGeofenceOverlay: (siteId: string) => boolean
  pickSite: (siteId: string) => boolean
  pickAsset: (assetId: string) => boolean
}

export type GlobeE2EBridgeState = {
  viewerReady: boolean
  selectedSiteId: string | null
  selectedAssetId: string | null
  selectedSignalId: string | null
  sites: Site[]
  assets: Asset[]
  signals: Signal[]
  coverageCircles: CoverageCircle[]
  readings: TelemetryMap
  isReplaying: boolean
  focusPosition: GlobeEngineReturn['focusPosition']
  projectPosition: GlobeEngineReturn['projectPosition']
  projectRenderedPosition: GlobeEngineReturn['projectRenderedPosition']
  inspectCanvasPosition: GlobeEngineReturn['inspectCanvasPosition']
  dispatchSyntheticPick: GlobeEngineReturn['dispatchSyntheticPick']
  pickCanvasPosition: GlobeEngineReturn['pickCanvasPosition']
}

declare global {
  interface Window {
    __resilienceGlobeBench?: GlobeBenchmarkApi
    __resilienceGlobeE2E?: GlobeE2EApi
  }
}
