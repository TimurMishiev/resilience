import { useEntitySelectionSync } from './useEntitySelectionSync'
import { useEvidenceLinkedIds } from './useEvidenceLinkedIds'
import { useMapSelectionState } from './useMapSelectionState'
import type { Asset, Signal, Site, Task } from '../api/types'
import type { TelemetryMap } from '../lib/telemetry'

type UseMapSelectionOrchestrationArgs = {
  allTasks: Task[]
  assets: Asset[]
  assetsLoaded: boolean
  asOf: string | null
  isReplaying: boolean
  readings: TelemetryMap
  signalError: Error | null
  signals: Signal[]
  signalsConnected: boolean
  sites: Site[]
  sitesLoaded: boolean
}

export function useMapSelectionOrchestration({
  allTasks,
  assets,
  assetsLoaded,
  asOf,
  isReplaying,
  readings,
  signalError,
  signals,
  signalsConnected,
  sites,
  sitesLoaded,
}: UseMapSelectionOrchestrationArgs) {
  const {
    selectedSiteId,
    selectedAssetId,
    selectedSignalId,
    setSelectedSiteId,
    setSelectedAssetId,
    setSelectedSignalId,
    onSiteClick,
    onAssetClick,
    onSignalClick,
    urlSelectionAppliedRef,
    updateSelectionRoute,
  } = useEntitySelectionSync({
    source: 'map',
    signals,
    signalsConnected,
    signalError,
    sites,
    assets,
    sitesLoaded,
    assetsLoaded,
    isReplaying,
    asOf,
  })

  const { evidenceSignalIds, evidenceSiteIds } = useEvidenceLinkedIds(
    selectedSiteId,
    selectedSignalId,
    asOf,
  )

  const selectionState = useMapSelectionState({
    allTasks,
    assets,
    asOf,
    isReplaying,
    readings,
    selectedAssetId,
    selectedSignalId,
    selectedSiteId,
    setSelectedAssetId,
    setSelectedSignalId,
    setSelectedSiteId,
    signals,
    sites,
    updateSelectionRoute,
  })

  return {
    ...selectionState,
    evidenceSignalIds,
    evidenceSiteIds,
    onAssetClick,
    onSignalClick,
    onSiteClick,
    selectedAssetId,
    selectedSignalId,
    selectedSiteId,
    setSelectedAssetId,
    setSelectedSignalId,
    setSelectedSiteId,
    urlSelectionAppliedRef,
  }
}
