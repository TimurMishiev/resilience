import type { Asset, Signal, Site, SiteRiskScore, Task } from '../../api/types'
import type { TelemetryReading } from '../../lib/telemetry'
import type { Vessel, VesselTrack } from '../../api/vessels'
import { MapAssetPanel } from '../MapAssetPanel'
import { MapSignalPanel } from '../MapSignalPanel'
import { MapSitePanel } from '../MapSitePanel'

interface MapSelectionPanelsProps {
  selectedSite: Site | null
  selectedTasks: Task[]
  readiness: number | null
  riskBySiteId: Record<string, SiteRiskScore>
  role: string
  selectedAsset: Asset | null
  selectedLiveReading: TelemetryReading | null
  selectedSignal: Signal | null
  selectedVessel: Vessel | null
  vesselTracks: VesselTrack[]
  isReplaying: boolean
  onTransitioned: () => void
  onCloseSite: () => void
  onCloseAsset: () => void
  onCloseSignal: () => void
}

export function MapSelectionPanels({
  selectedSite,
  selectedTasks,
  readiness,
  riskBySiteId,
  role,
  selectedAsset,
  selectedLiveReading,
  selectedSignal,
  selectedVessel,
  vesselTracks,
  isReplaying,
  onTransitioned,
  onCloseSite,
  onCloseAsset,
  onCloseSignal,
}: MapSelectionPanelsProps) {
  return (
    <>
      {selectedSite && (
        <MapSitePanel
          site={selectedSite}
          tasks={selectedTasks}
          readiness={readiness}
          riskBySiteId={riskBySiteId}
          isReplaying={isReplaying}
          role={role}
          onTransitioned={onTransitioned}
          onClose={onCloseSite}
        />
      )}

      {selectedAsset && (
        <MapAssetPanel
          asset={selectedAsset}
          liveReading={selectedLiveReading}
          isReplaying={isReplaying}
          onClose={onCloseAsset}
        />
      )}

      {selectedSignal && (
        <MapSignalPanel
          signal={selectedSignal}
          vessel={selectedVessel}
          vesselTracks={vesselTracks}
          isReplaying={isReplaying}
          onClose={onCloseSignal}
        />
      )}
    </>
  )
}
