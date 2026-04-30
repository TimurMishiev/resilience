import { useEffect, useMemo, useRef } from 'react'
import { isPerfEnabled } from '../lib/perfInstrumentation'
import type { Signal, Site } from '../api/types'
import type { MapBenchmarkState, MapBenchmarkTarget } from '../components/map/types'
import { useMapBenchmarkBridge } from './useMapBenchmarkBridge'
import { useMapE2EBridge } from './useMapE2EBridge'

type CanvasPoint = {
  x: number
  y: number
}

type UseMapPageDiagnosticsArgs = {
  getZoom: () => number | null
  inspectCanvasPosition: (x: number, y: number) => { kind: string; id: string | null } | null
  mapLoaded: boolean
  projectPosition: (lng: number, lat: number) => CanvasPoint | null
  selectedAssetId: string | null
  selectedSignalId: string | null
  selectedSiteId: string | null
  setSelectedAssetId: (id: string | null) => void
  setSelectedSignalId: (id: string | null) => void
  setSelectedSiteId: (id: string | null) => void
  showCoverage: boolean
  showHeatmap: boolean
  showSignals: boolean
  signalCount: number
  signals: Signal[]
  signalsConnected: boolean
  sites: Site[]
  telemetryConnected: boolean
}

export function useMapPageDiagnostics({
  getZoom,
  inspectCanvasPosition,
  mapLoaded,
  projectPosition,
  selectedAssetId,
  selectedSignalId,
  selectedSiteId,
  setSelectedAssetId,
  setSelectedSignalId,
  setSelectedSiteId,
  showCoverage,
  showHeatmap,
  showSignals,
  signalCount,
  signals,
  signalsConnected,
  sites,
  telemetryConnected,
}: UseMapPageDiagnosticsArgs) {
  useMapE2EBridge({
    mapLoaded,
    getZoom,
    telemetryConnected,
    signalsConnected,
    signalCount,
    selectedSiteId,
    selectedAssetId,
    selectedSignalId,
    sites,
    projectPosition,
    inspectCanvasPosition,
  })

  const perfEnabled = useMemo(() => isPerfEnabled(), [])

  const benchmarkTarget: MapBenchmarkTarget | null = useMemo(() => {
    if (signals.length === 0) return null
    const firstSignal = [...signals].sort((a, b) => a.id.localeCompare(b.id))[0]
    return {
      signalId: firstSignal.id,
      signalType: firstSignal.signal_type,
      globalSignalCount: signals.length,
    }
  }, [signals])

  const benchStateRef = useRef<MapBenchmarkState>({
    mapLoaded: false,
    siteCount: 0,
    signalCount: 0,
    selectedSiteId: null,
    selectedAssetId: null,
    selectedSignalId: null,
    showSignals: true,
    showHeatmap: false,
    showCoverage: true,
    benchmarkTarget: null,
  })
  const benchSitesRef = useRef(sites)

  useEffect(() => {
    benchStateRef.current = {
      mapLoaded,
      siteCount: sites.length,
      signalCount,
      selectedSiteId,
      selectedAssetId,
      selectedSignalId,
      showSignals,
      showHeatmap,
      showCoverage,
      benchmarkTarget,
    }
    benchSitesRef.current = sites
  }, [
    benchmarkTarget,
    mapLoaded,
    selectedAssetId,
    selectedSignalId,
    selectedSiteId,
    showCoverage,
    showHeatmap,
    showSignals,
    signalCount,
    sites,
  ])

  useMapBenchmarkBridge({
    perfEnabled,
    stateRef: benchStateRef,
    sitesRef: benchSitesRef,
    setSelectedSiteId,
    setSelectedAssetId,
    setSelectedSignalId,
  })
}
