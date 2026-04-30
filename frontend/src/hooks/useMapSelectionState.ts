import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useVessels, useVesselTracks } from './useVessels'
import type { Asset, Signal, Site, Task } from '../api/types'
import type { TelemetryMap } from '../lib/telemetry'
import { computeReadiness } from '../lib/formatters'
import { buildReplayVessel } from '../lib/replayVessel'
import { getLiveTelemetryReading } from '../lib/assetPresentation'

type UseMapSelectionStateArgs = {
  allTasks: Task[]
  assets: Asset[]
  asOf: string | null
  isReplaying: boolean
  readings: TelemetryMap
  selectedAssetId: string | null
  selectedSignalId: string | null
  selectedSiteId: string | null
  setSelectedAssetId: (id: string | null) => void
  setSelectedSignalId: (id: string | null) => void
  setSelectedSiteId: (id: string | null) => void
  signals: Signal[]
  sites: Site[]
  updateSelectionRoute: (args: { siteId: string | null; assetId: string | null; signalId: string | null }) => void
}

export function useMapSelectionState({
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
}: UseMapSelectionStateArgs) {
  const queryClient = useQueryClient()

  const tasksBySite = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const task of allTasks) {
      if (!map[task.site_id]) map[task.site_id] = []
      map[task.site_id].push(task)
    }
    return map
  }, [allTasks])

  const selectedSignal = selectedSignalId ? (signals.find(signal => signal.id === selectedSignalId) ?? null) : null
  const selectedVesselMmsi = selectedSignal?.signal_type === 'vessel_position' ? selectedSignal.external_id : null

  const { data: vesselLookup } = useVessels(
    selectedVesselMmsi ? { mmsi: selectedVesselMmsi, per_page: 1 } : undefined,
    { enabled: !!selectedVesselMmsi, refetchInterval: isReplaying ? false : 30_000 },
  )
  const selectedVesselRecord = vesselLookup?.data?.[0] ?? null

  const { data: vesselTrackRes } = useVesselTracks(selectedVesselRecord?.id ?? null, {
    limit: 300,
    ...(isReplaying && asOf ? { to: asOf } : {}),
  })
  const vesselTracks = useMemo(() => vesselTrackRes?.data ?? [], [vesselTrackRes?.data])

  const selectedVessel = useMemo(
    () => (
      isReplaying
        ? buildReplayVessel(selectedSignal, selectedVesselRecord?.id ?? null, vesselTracks, asOf)
        : selectedVesselRecord
    ),
    [asOf, isReplaying, selectedSignal, selectedVesselRecord, vesselTracks],
  )

  const selectedSite = selectedSiteId ? (sites.find(site => site.id === selectedSiteId) ?? null) : null
  const selectedTasks = selectedSiteId ? (tasksBySite[selectedSiteId] ?? []) : []
  const readiness = computeReadiness(selectedTasks)
  const selectedAsset = selectedAssetId ? (assets.find(asset => asset.id === selectedAssetId) ?? null) : null
  const selectedLiveReading = getLiveTelemetryReading(selectedAssetId, readings, { allowHistorical: isReplaying })

  const hasSelection = Boolean(selectedSiteId || selectedAssetId || selectedSignalId)

  const clearSelection = useCallback(() => {
    setSelectedSiteId(null)
    setSelectedAssetId(null)
    setSelectedSignalId(null)
    updateSelectionRoute({ siteId: null, assetId: null, signalId: null })
  }, [setSelectedAssetId, setSelectedSignalId, setSelectedSiteId, updateSelectionRoute])

  const handleTransitioned = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    queryClient.invalidateQueries({ queryKey: ['readiness'] })
  }, [queryClient])

  return {
    clearSelection,
    handleTransitioned,
    hasSelection,
    readiness,
    selectedAsset,
    selectedLiveReading,
    selectedSignal,
    selectedSite,
    selectedTasks,
    selectedVessel,
    tasksBySite,
    vesselTracks,
  }
}
