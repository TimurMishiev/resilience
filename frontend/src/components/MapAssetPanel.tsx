import { Divider, Tag } from '@blueprintjs/core'
import type { Asset } from '../api/types'
import type { TelemetryReading } from '../lib/telemetry'
import { humanize } from '../utils/humanize'
import { assetStatusIntent, batteryIntent } from '../lib/taskIntents'
import { headingLabel, formatTimestampTime } from '../lib/formatters'

function assetTypeIcon(type: Asset['asset_type']): string {
  switch (type) {
    case 'vehicle':   return '🚗'
    case 'equipment': return '📡'
    case 'personnel': return '🪖'
    default:          return '●'
  }
}

interface MapAssetPanelProps {
  asset: Asset
  liveReading: TelemetryReading | null
  isReplaying: boolean
  onClose: () => void
}

export function MapAssetPanel({
  asset,
  liveReading,
  isReplaying,
  onClose,
}: MapAssetPanelProps) {
  return (
    <div className="map-panel map-panel--asset bp6-dark">
      <div className="map-panel-header">
        <span className="map-panel-title">
          {assetTypeIcon(asset.asset_type)} {asset.name}
        </span>
        <button
          className="map-panel-close bp6-button bp6-minimal bp6-icon-cross"
          onClick={onClose}
          aria-label="Close"
        />
      </div>

      <div className="map-panel-tags">
        <Tag minimal>{asset.asset_type}</Tag>
        <Tag minimal intent={assetStatusIntent(asset.status)}>
          {humanize(asset.status)}
        </Tag>
      </div>

      <Divider />

      {liveReading ? (
        <div className="map-telemetry-readings">
          <div className="map-telemetry-row">
            <span className="map-telemetry-label">Battery</span>
            <div className="map-telemetry-bar-wrap">
              <div
                className={`map-telemetry-bar map-telemetry-bar--${
                  liveReading.battery < 20 ? 'danger'
                  : liveReading.battery < 40 ? 'warning'
                  : 'success'
                }`}
                style={{ width: `${liveReading.battery}%` }}
              />
            </div>
            <Tag minimal intent={batteryIntent(liveReading.battery)}>
              {liveReading.battery.toFixed(0)}%
            </Tag>
          </div>

          <div className="map-telemetry-row">
            <span className="map-telemetry-label">Speed</span>
            <span className="map-telemetry-value">
              {liveReading.speed.toFixed(1)} m/s
            </span>
          </div>

          <div className="map-telemetry-row">
            <span className="map-telemetry-label">Heading</span>
            <span className="map-telemetry-value">
              {headingLabel(liveReading.heading)} ({liveReading.heading}°)
            </span>
          </div>

          <div className="map-telemetry-row">
            <span className="map-telemetry-label">Position</span>
            <span className="map-telemetry-value">
              {liveReading.lat.toFixed(4)}, {liveReading.lng.toFixed(4)}
            </span>
          </div>

          <div className="map-telemetry-row">
            <span className="map-telemetry-label">Last seen</span>
            <span className="map-telemetry-value bp6-text-muted">
              {formatTimestampTime(liveReading.ts)}
            </span>
          </div>
        </div>
      ) : (
        <p className="bp6-text-muted map-no-tasks">
          {isReplaying ? 'No telemetry snapshot available for this replay time.' : 'Awaiting telemetry data…'}
        </p>
      )}
    </div>
  )
}
