import { useState } from 'react'
import {
  Callout,
  Classes,
  HTMLSelect,
  HTMLTable,
  NonIdealState,
  Tag,
} from '@blueprintjs/core'
import { useSignals } from '../hooks/useSignals'
import type { SignalSource, SignalType } from '../api/types'

const SKELETON_ROWS = 8

const SOURCE_LABELS: Record<string, string> = {
  opensky:       'OpenSky',
  ais:           'AIS',
  usgs_seismic:  'USGS Seismic',
  gpsjam:        'GPSJam',
  firms_wildfire:'FIRMS Wildfire',
  manual:        'Manual',
}

const TYPE_LABELS: Record<string, string> = {
  aircraft_position: 'Aircraft',
  vessel_position:   'Vessel',
  seismic_event:     'Seismic',
  gps_jamming:       'GPS Jam',
  wildfire:          'Wildfire',
  manual:            'Manual',
}

const TYPE_INTENTS: Record<string, 'primary' | 'warning' | 'danger' | 'none' | 'success'> = {
  aircraft_position: 'primary',
  vessel_position:   'primary',
  seismic_event:     'danger',
  gps_jamming:       'warning',
  wildfire:          'danger',
  manual:            'none',
}

function formatRelativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export default function SignalFeedPage() {
  const [sourceFilter, setSourceFilter] = useState<SignalSource | ''>('')
  const [typeFilter,   setTypeFilter]   = useState<SignalType | ''>('')

  const { data, error, isPending } = useSignals({
    per_page: 100,
    ...(sourceFilter ? { source: sourceFilter } : {}),
    ...(typeFilter   ? { signal_type: typeFilter } : {}),
  })

  if (error) {
    return (
      <div className="page-content">
        <Callout intent="danger" title="Failed to load signals">
          {error.message}
        </Callout>
      </div>
    )
  }

  const signals = data?.data ?? []
  const total   = data?.meta?.total ?? signals.length

  return (
    <div className="page-content">
      <div className="page-header">
        <h2 className="bp6-heading">Signal Feed</h2>
        <span className="bp6-text-muted">
          {isPending
            ? <span className={Classes.SKELETON} style={{ width: 64, display: 'inline-block' }}>&nbsp;</span>
            : `${total} signals`}
        </span>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <HTMLSelect
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value as SignalSource | '')}
          style={{ minWidth: 140 }}
        >
          <option value="">All sources</option>
          {Object.entries(SOURCE_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </HTMLSelect>

        <HTMLSelect
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as SignalType | '')}
          style={{ minWidth: 140 }}
        >
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </HTMLSelect>
      </div>

      {!isPending && signals.length === 0 && (
        <NonIdealState
          icon="feed"
          title="No signals yet"
          description="Signal ingestion starts automatically when the server boots. Aircraft (OpenSky) and seismic (USGS) data arrive within 60–300 seconds. Vessel (AIS Hub) and wildfire (NASA FIRMS) feeds require API keys in .env."
        />
      )}

      {(isPending || signals.length > 0) && (
        <HTMLTable className="data-table" striped interactive>
          <thead>
            <tr>
              <th>Source</th>
              <th>Type</th>
              <th>External ID</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Speed / Mag</th>
              <th>Alt / Depth</th>
              <th>Occurred</th>
            </tr>
          </thead>
          <tbody>
            {isPending
              ? Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                  <tr key={i}>
                    <td><span className={Classes.SKELETON} style={{ width: 72, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 80, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ display: 'block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 64, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 64, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 48, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 56, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 72, display: 'inline-block' }}>&nbsp;</span></td>
                  </tr>
                ))
              : signals.map(signal => {
                  // Column 6: speed (m/s) for moving objects; magnitude for seismic/wildfire
                  const isSeismic  = signal.signal_type === 'seismic_event'
                  const isWildfire = signal.signal_type === 'wildfire'
                  const speedOrMag = (isSeismic || isWildfire)
                    ? (signal.magnitude != null ? `M ${Number(signal.magnitude).toFixed(1)}` : '—')
                    : (signal.speed      != null ? `${Number(signal.speed).toFixed(1)} m/s`  : '—')

                  // Column 7: altitude for aircraft; depth (km) for seismic
                  const altOrDepth = isSeismic
                    ? (signal.raw_payload?.depth_km != null
                        ? `${Number(signal.raw_payload.depth_km).toFixed(0)} km`
                        : '—')
                    : (signal.altitude != null
                        ? `${Number(signal.altitude).toFixed(0)} m`
                        : '—')

                  return (
                    <tr key={signal.id}>
                      <td>
                        <Tag minimal intent="none">
                          {SOURCE_LABELS[signal.source] ?? signal.source}
                        </Tag>
                      </td>
                      <td>
                        <Tag minimal intent={TYPE_INTENTS[signal.signal_type] ?? 'none'}>
                          {TYPE_LABELS[signal.signal_type] ?? signal.signal_type}
                        </Tag>
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>{signal.external_id}</td>
                      <td className="mono">{Number(signal.lat).toFixed(4)}</td>
                      <td className="mono">{Number(signal.lng).toFixed(4)}</td>
                      <td className="mono">{speedOrMag}</td>
                      <td className="mono">{altOrDepth}</td>
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                        {formatRelativeTime(signal.occurred_at)}
                      </td>
                    </tr>
                  )
                })
            }
          </tbody>
        </HTMLTable>
      )}
    </div>
  )
}
