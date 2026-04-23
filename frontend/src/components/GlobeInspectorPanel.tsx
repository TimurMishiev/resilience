import { Button, Callout, Divider, Tag } from '@blueprintjs/core'
import type { Asset, Site, Task, Signal, AreaOfOperation } from '../api/types'
import type { Vessel } from '../api/vessels'
import type { TelemetryReading } from '../lib/telemetry'
import { humanize } from '../utils/humanize'
import { workflowIntent, batteryIntent, assetStatusIntent } from '../lib/taskIntents'
import { headingLabel, formatTimestampFull } from '../lib/formatters'
import {
  SIGNAL_COLORS,
  SIGNAL_LABELS,
  SOURCE_LABELS,
  ALERT_LEVEL_INTENT,
} from '../lib/signalConfig'
// Note: MapSiteAlertsSection is map-surface-named but entity-agnostic — props
// are (siteId, referenceTimeMs, canTriage, onSelectSignal) with no map-
// specific state coupling. Reused on globe for CTO P2 parity. A future
// rename to SiteAlertsSection is a mechanical refactor, deliberately
// deferred to keep this slice narrow.
import { MapSiteAlertsSection } from './MapSiteAlertsSection'

function assetTypeIcon(type: Asset['asset_type']): string {
  switch (type) {
    case 'vehicle':   return 'VEH'
    case 'equipment': return 'EQP'
    case 'personnel': return 'PRS'
    default:          return 'AST'
  }
}

export interface GlobeInspectorPanelProps {
  inspectorTitle: string
  selectedSite: Site | null
  selectedAsset: Asset | null
  selectedSignal: Signal | null
  selectedVessel: Vessel | null
  selectedTasks: Task[]
  selectedLiveReading: TelemetryReading | null
  selectedAreaOfOperation: AreaOfOperation | null
  nearestSignals: Array<{ signal: Signal; distanceKm: number }>
  nearestResponseAssets: Array<{ asset: Asset; reading: TelemetryReading | null; distanceKm: number }>
  geofenceHits: number
  readiness: number | null
  isReplaying: boolean
  telemetryConnected: boolean
  tacticalMapHref: string
  /** Replay-aware clock threaded through by GlobePage — powers freshness
   *  rendering and timestamp relative-times in the alerts section. */
  referenceTimeMs: number
  /** True when current user has the commander/operator role required to
   *  acknowledge alerts. MapSiteAlertsSection hides Ack/Escalate buttons
   *  when this is false. */
  canTriage: boolean
  /** Caller-owned handler invoked when the operator clicks "Inspect signal"
   *  on an alert row. GlobePage wires this to onSignalClick so the selection
   *  flows through the same route the 3D click handler uses. */
  onSelectSignal: (signalId: string) => void
  onClose: () => void
  navigate: (path: string) => void
}

export function GlobeInspectorPanel({
  inspectorTitle,
  selectedSite,
  selectedAsset,
  selectedSignal,
  selectedVessel,
  selectedTasks,
  selectedLiveReading,
  selectedAreaOfOperation,
  nearestSignals,
  nearestResponseAssets,
  geofenceHits,
  readiness,
  isReplaying,
  telemetryConnected,
  tacticalMapHref,
  referenceTimeMs,
  canTriage,
  onSelectSignal,
  onClose,
  navigate,
}: GlobeInspectorPanelProps) {
  return (
    <div className="globe-panel bp6-dark">
      <div className="globe-panel-header">
        <span className="globe-panel-title">{inspectorTitle}</span>
        <button
          className="globe-panel-close bp6-button bp6-minimal bp6-icon-cross"
          onClick={onClose}
          aria-label="Close"
        />
      </div>

      {selectedSite && (
        <>
          <div className="globe-panel-tags">
            <Tag minimal intent={selectedSite.status === 'active' ? 'success' : 'none'}>
              {selectedSite.status}
            </Tag>
            <Tag minimal>
              {selectedTasks.length} task{selectedTasks.length !== 1 ? 's' : ''}
            </Tag>
            {selectedSite.geofence_radius_km > 0 && (
              <Tag minimal intent={geofenceHits > 0 ? 'warning' : 'none'}>
                Geofence {selectedSite.geofence_radius_km} km
              </Tag>
            )}
            {selectedAreaOfOperation && (
              <Tag minimal>{selectedAreaOfOperation.name}</Tag>
            )}
            {readiness !== null && (
              <Tag minimal intent={readiness >= 0.8 ? 'success' : readiness >= 0.5 ? 'warning' : 'danger'}>
                {Math.round(readiness * 100)}% ready
              </Tag>
            )}
          </div>

          <p className="globe-panel-coords bp6-text-muted">
            {Number(selectedSite.latitude).toFixed(4)},&nbsp;
            {Number(selectedSite.longitude).toFixed(4)}
          </p>

          {selectedTasks.length > 0 ? (
            <>
              <Divider />
              <ul className="globe-task-list">
                {selectedTasks.map(t => (
                  <li key={t.id} className="globe-task-item">
                    <span className="globe-task-title">{t.title}</span>
                    <Tag minimal intent={workflowIntent(t.workflow_status)}>
                      {humanize(t.workflow_status)}
                    </Tag>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="bp6-text-muted globe-no-tasks">No tasks assigned.</p>
          )}

          <Divider />
          <MapSiteAlertsSection
            siteId={selectedSite.id}
            referenceTimeMs={referenceTimeMs}
            canTriage={canTriage}
            onSelectSignal={onSelectSignal}
          />

          <Divider />
          <div className="globe-telemetry-readings">
            {selectedAreaOfOperation && (
              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">AO</span>
                <span className="globe-telemetry-value">
                  {selectedAreaOfOperation.name} · {selectedAreaOfOperation.threat_level.toUpperCase()}
                </span>
              </div>
            )}
            {selectedSite.geofence_radius_km > 0 && (
              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">Inside ring</span>
                <span className="globe-telemetry-value">
                  {geofenceHits} of {nearestSignals.length} nearest signals
                </span>
              </div>
            )}
            <div className="globe-telemetry-row">
              <span className="globe-telemetry-label">Nearest</span>
              <span className="globe-telemetry-value">
                {nearestSignals.length > 0 ? `${nearestSignals[0].distanceKm.toFixed(1)} km` : 'No nearby signals'}
              </span>
            </div>
          </div>

          {nearestSignals.length > 0 && (
            <>
              <Divider />
              <div className="globe-threats">
                <div className="globe-threats-title">Nearest Signals</div>
                {nearestSignals.map(({ signal, distanceKm }) => {
                  const withinGeofence = selectedSite.geofence_radius_km > 0 && distanceKm <= selectedSite.geofence_radius_km
                  return (
                    <div key={signal.id} className="globe-threat-row">
                      <span
                        className="globe-threat-dot"
                        style={{ background: SIGNAL_COLORS[signal.signal_type] ?? '#ffffff' }}
                      />
                      <div className="globe-threat-body">
                        <div className="globe-threat-name">
                          {SIGNAL_LABELS[signal.signal_type] ?? signal.signal_type}
                          {withinGeofence ? ' · Inside geofence' : ''}
                        </div>
                        <div className="globe-threat-meta bp6-text-muted">
                          {distanceKm.toFixed(1)} km · {new Date(signal.occurred_at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {nearestResponseAssets.length > 0 && (
            <>
              <Divider />
              <div className="globe-threats">
                <div className="globe-threats-title">Response Assets</div>
                {nearestResponseAssets.map(({ asset, reading, distanceKm }) => (
                  <div key={asset.id} className="globe-threat-row">
                    <span className="globe-threat-dot" style={{ background: '#00d4ff' }} />
                    <div className="globe-threat-body">
                      <div className="globe-threat-name">
                        {asset.name} · {humanize(asset.status)}
                      </div>
                      <div className="globe-threat-meta bp6-text-muted">
                        {distanceKm.toFixed(1)} km
                        {reading ? ` · live ${formatTimestampFull(reading.ts)}` : ' · no live telemetry'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <Divider />
          <div className="globe-panel-actions">
            <Button small icon="map" onClick={() => navigate(tacticalMapHref)}>
              Open Tactical Map
            </Button>
          </div>
        </>
      )}

      {selectedAsset && (
        <>
          <div className="globe-panel-tags">
            <Tag minimal>{assetTypeIcon(selectedAsset.asset_type)}</Tag>
            <Tag minimal>{selectedAsset.asset_type}</Tag>
            <Tag minimal intent={assetStatusIntent(selectedAsset.status)}>
              {humanize(selectedAsset.status)}
            </Tag>
            <Tag minimal intent={telemetryConnected ? 'success' : 'warning'}>
              {isReplaying ? 'Replay snapshot' : telemetryConnected ? 'Telemetry live' : 'Telemetry reconnecting'}
            </Tag>
          </div>

          {selectedLiveReading ? (
            <div className="globe-telemetry-readings">
              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">Battery</span>
                <div className="globe-telemetry-bar-wrap">
                  <div
                    className={`globe-telemetry-bar globe-telemetry-bar--${
                      selectedLiveReading.battery < 20 ? 'danger'
                      : selectedLiveReading.battery < 40 ? 'warning'
                      : 'success'
                    }`}
                    style={{ width: `${selectedLiveReading.battery}%` }}
                  />
                </div>
                <Tag minimal intent={batteryIntent(selectedLiveReading.battery)}>
                  {selectedLiveReading.battery.toFixed(0)}%
                </Tag>
              </div>

              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">Speed</span>
                <span className="globe-telemetry-value">{selectedLiveReading.speed.toFixed(1)} m/s</span>
              </div>

              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">Heading</span>
                <span className="globe-telemetry-value">
                  {headingLabel(selectedLiveReading.heading)} ({selectedLiveReading.heading}°)
                </span>
              </div>

              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">Position</span>
                <span className="globe-telemetry-value">
                  {selectedLiveReading.lat.toFixed(4)}, {selectedLiveReading.lng.toFixed(4)}
                </span>
              </div>

              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">Last seen</span>
                <span className="globe-telemetry-value bp6-text-muted">
                  {formatTimestampFull(selectedLiveReading.ts)}
                </span>
              </div>
            </div>
          ) : (
            <p className="bp6-text-muted globe-no-tasks">
              {isReplaying ? 'No telemetry snapshot available for this replay time.' : 'Awaiting telemetry data...'}
            </p>
          )}

          <Divider />
          <div className="globe-panel-actions">
            <Button small icon="map" onClick={() => navigate(tacticalMapHref)}>
              Open Tactical Map
            </Button>
          </div>
        </>
      )}

      {selectedSignal && (
        <>
          <div className="globe-panel-tags">
            <Tag
              minimal
              style={{
                background: `${SIGNAL_COLORS[selectedSignal.signal_type] ?? '#ffffff'}28`,
                color: SIGNAL_COLORS[selectedSignal.signal_type] ?? '#ffffff',
              }}
            >
              {humanize(selectedSignal.signal_type)}
            </Tag>
            <Tag minimal>{SOURCE_LABELS[selectedSignal.source] ?? selectedSignal.source}</Tag>
            {selectedSignal.signal_type === 'disaster_alert' &&
             typeof selectedSignal.raw_payload.alert_level === 'string' && (
              <Tag minimal intent={ALERT_LEVEL_INTENT[selectedSignal.raw_payload.alert_level] ?? 'none'}>
                {selectedSignal.raw_payload.alert_level}
              </Tag>
            )}
            {selectedVessel?.loitering && <Tag intent="warning" minimal>Loitering</Tag>}
            {selectedVessel?.dark && <Tag intent="danger" minimal>Dark</Tag>}
          </div>

          <p className="globe-panel-coords bp6-text-muted">
            {Number(selectedSignal.lat).toFixed(4)}, {Number(selectedSignal.lng).toFixed(4)}
          </p>

          <Divider />

          {isReplaying && selectedSignal.signal_type === 'vessel_position' && (
            <>
              <Callout intent="warning" compact className="map-replay-notice">
                Vessel identity and trail data reflect AIS history up to the replay timestamp. Live-only enrichment fields remain limited during replay.
              </Callout>
              <Divider />
            </>
          )}

          <div className="globe-telemetry-readings">
            {selectedVessel?.mmsi && (
              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">MMSI</span>
                <span className="globe-telemetry-value">{selectedVessel.mmsi}</span>
              </div>
            )}
            {selectedVessel?.vessel_type && (
              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">Type</span>
                <span className="globe-telemetry-value">{selectedVessel.vessel_type}</span>
              </div>
            )}
            {selectedVessel?.flag && (
              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">Flag</span>
                <span className="globe-telemetry-value">{selectedVessel.flag}</span>
              </div>
            )}
            {selectedVessel?.destination && (
              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">Destination</span>
                <span className="globe-telemetry-value">{selectedVessel.destination}</span>
              </div>
            )}
            {selectedVessel?.loitering_since && (
              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">Loitering since</span>
                <span className="globe-telemetry-value bp6-text-muted">
                  {formatTimestampFull(Date.parse(selectedVessel.loitering_since) / 1000)}
                </span>
              </div>
            )}
            {selectedSignal.signal_type === 'conflict_event' && typeof selectedSignal.raw_payload.event_type === 'string' && (
              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">Event</span>
                <span className="globe-telemetry-value">{selectedSignal.raw_payload.event_type}</span>
              </div>
            )}
            {selectedSignal.signal_type === 'conflict_event' && typeof selectedSignal.raw_payload.country === 'string' && (
              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">Country</span>
                <span className="globe-telemetry-value">{selectedSignal.raw_payload.country}</span>
              </div>
            )}
            {selectedSignal.signal_type === 'disaster_alert' && typeof selectedSignal.raw_payload.event_type_name === 'string' && (
              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">Type</span>
                <span className="globe-telemetry-value">{selectedSignal.raw_payload.event_type_name}</span>
              </div>
            )}
            {selectedSignal.signal_type === 'disaster_alert' && typeof selectedSignal.raw_payload.country === 'string' && (
              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">Country</span>
                <span className="globe-telemetry-value">{selectedSignal.raw_payload.country}</span>
              </div>
            )}
            {selectedSignal.magnitude !== null && selectedSignal.magnitude !== undefined && (
              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">
                  {selectedSignal.signal_type === 'disaster_alert' ? 'Impact' : 'Magnitude'}
                </span>
                <span className="globe-telemetry-value">{Number(selectedSignal.magnitude).toFixed(1)}</span>
              </div>
            )}
            {selectedSignal.altitude !== null && selectedSignal.altitude !== undefined && (
              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">Altitude</span>
                <span className="globe-telemetry-value">{Number(selectedSignal.altitude).toFixed(0)} m</span>
              </div>
            )}
            {selectedSignal.speed !== null && selectedSignal.speed !== undefined && (
              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">Speed</span>
                <span className="globe-telemetry-value">{Number(selectedSignal.speed).toFixed(0)} kn</span>
              </div>
            )}
            {selectedSignal.heading !== null && selectedSignal.heading !== undefined && (
              <div className="globe-telemetry-row">
                <span className="globe-telemetry-label">Heading</span>
                <span className="globe-telemetry-value">{Number(selectedSignal.heading).toFixed(0)}°</span>
              </div>
            )}
            <div className="globe-telemetry-row">
              <span className="globe-telemetry-label">Occurred</span>
              <span className="globe-telemetry-value bp6-text-muted">
                {new Date(selectedSignal.occurred_at).toLocaleString()}
              </span>
            </div>
          </div>

          <Divider />
          <div className="globe-panel-actions">
            <Button small icon="map" onClick={() => navigate(tacticalMapHref)}>
              Open Tactical Map
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
