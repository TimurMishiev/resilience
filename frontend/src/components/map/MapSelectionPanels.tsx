import type { Asset, Signal, Site, SiteRiskScore, Task } from '../../api/types'
import type { TelemetryReading } from '../../lib/telemetry'
import type { Vessel, VesselTrack } from '../../api/vessels'
import type { UserRole } from '../../hooks/useRole'
import { MapAssetPanel } from '../MapAssetPanel'
import { MapSignalPanel } from '../MapSignalPanel'
import { MapSitePanel } from '../MapSitePanel'

interface MapSelectionPanelsProps {
  selectedSite: Site | null
  selectedTasks: Task[]
  readiness: number | null
  riskBySiteId: Record<string, SiteRiskScore>
  role: UserRole
  canTriage: boolean
  referenceTimeMs: number
  selectedAsset: Asset | null
  selectedLiveReading: TelemetryReading | null
  selectedSignal: Signal | null
  selectedVessel: Vessel | null
  vesselTracks: VesselTrack[]
  isReplaying: boolean
  onSelectSite: (siteId: string | null) => void
  onSelectSignal: (signalId: string | null) => void
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
  canTriage,
  referenceTimeMs,
  selectedAsset,
  selectedLiveReading,
  selectedSignal,
  selectedVessel,
  vesselTracks,
  isReplaying,
  onSelectSite,
  onSelectSignal,
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
          canTriage={canTriage}
          referenceTimeMs={referenceTimeMs}
          onSelectSignal={onSelectSignal}
          onTransitioned={onTransitioned}
          onClose={onCloseSite}
        />
      )}

      {selectedAsset && (
        <MapAssetPanel
          asset={selectedAsset}
          liveReading={selectedLiveReading}
          isReplaying={isReplaying}
          canTriage={canTriage}
          referenceTimeMs={referenceTimeMs}
          onSelectHomeSite={onSelectSite}
          onSelectSignal={onSelectSignal}
          onClose={onCloseAsset}
        />
      )}

      {selectedSignal && (
        <MapSignalPanel
          signal={selectedSignal}
          vessel={selectedVessel}
          vesselTracks={vesselTracks}
          isReplaying={isReplaying}
          canTriage={canTriage}
          referenceTimeMs={referenceTimeMs}
          onSelectSite={onSelectSite}
          onClose={onCloseSignal}
        />
      )}
    </>
  )
}
