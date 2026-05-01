import { useMapLibreEngine, type MapEngineInput } from './useMapLibreEngine'
import { useMapPageDiagnostics } from './useMapPageDiagnostics'
import { useMapUrlSelectionHydration } from './useMapUrlSelectionHydration'
import type { Location } from 'react-router-dom'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

type UseMapEngineOrchestrationArgs = MapEngineInput & {
  location: Location
  signalCount: number
  signalsConnected: boolean
  telemetryConnected: boolean
  setSelectedSiteId: Dispatch<SetStateAction<string | null>>
  setSelectedAssetId: Dispatch<SetStateAction<string | null>>
  setSelectedSignalId: Dispatch<SetStateAction<string | null>>
  urlSelectionAppliedRef: MutableRefObject<boolean>
}

export function useMapEngineOrchestration({
  location,
  signalCount,
  signalsConnected,
  telemetryConnected,
  setSelectedSiteId,
  setSelectedAssetId,
  setSelectedSignalId,
  urlSelectionAppliedRef,
  ...engineInput
}: UseMapEngineOrchestrationArgs) {
  const {
    mapLoaded,
    engineError,
    retryEngine,
    flyTo,
    getZoom,
    projectPosition,
    inspectCanvasPosition,
    resize,
  } = useMapLibreEngine(engineInput)

  useMapUrlSelectionHydration({
    mapLoaded,
    location,
    sites: engineInput.sites,
    assets: engineInput.assets,
    signals: engineInput.signals,
    readings: engineInput.readings,
    isReplaying: engineInput.isReplaying,
    flyTo,
    urlSelectionAppliedRef,
    setSelectedSiteId,
    setSelectedAssetId,
    setSelectedSignalId,
  })

  useMapPageDiagnostics({
    getZoom,
    inspectCanvasPosition,
    mapLoaded,
    projectPosition,
    selectedAssetId: engineInput.selectedAssetId,
    selectedSignalId: engineInput.selectedSignalId,
    selectedSiteId: engineInput.selectedSiteId,
    setSelectedAssetId,
    setSelectedSignalId,
    setSelectedSiteId,
    showCoverage: engineInput.showCoverage,
    showHeatmap: engineInput.showHeatmap,
    showSignals: engineInput.showSignals,
    signalCount,
    signals: engineInput.signals,
    signalsConnected,
    sites: engineInput.sites,
    telemetryConnected,
  })

  return {
    engineError,
    mapLoaded,
    resize,
    retryEngine,
  }
}
