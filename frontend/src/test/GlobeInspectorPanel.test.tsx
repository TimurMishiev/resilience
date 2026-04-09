import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AreaOfOperation, Asset, Signal, Site, Task } from '../api/types'
import type { TelemetryReading } from '../lib/telemetry'
import type { Vessel } from '../api/vessels'
import { GlobeInspectorPanel } from '../components/GlobeInspectorPanel'

const baseProps = {
  inspectorTitle: 'Inspector',
  selectedSite: null,
  selectedAsset: null,
  selectedSignal: null,
  selectedVessel: null,
  selectedTasks: [] as Task[],
  selectedLiveReading: null as TelemetryReading | null,
  selectedAreaOfOperation: null as AreaOfOperation | null,
  nearestSignals: [] as Array<{ signal: Signal; distanceKm: number }>,
  nearestResponseAssets: [] as Array<{ asset: Asset; reading: TelemetryReading | null; distanceKm: number }>,
  geofenceHits: 0,
  readiness: null as number | null,
  isReplaying: false,
  telemetryConnected: true,
  tacticalMapHref: '/map?site_id=site-1',
  onClose: vi.fn(),
  navigate: vi.fn(),
}

const site: Site = {
  id: 'site-1',
  name: 'Site Alpha',
  latitude: 51.5,
  longitude: 0.12,
  status: 'active',
  area_of_operation_id: 'ao-1',
  flagged_at: null,
  flag_reason: null,
  geofence_radius_km: 5,
  created_at: '2026-03-26T10:00:00.000Z',
  updated_at: '2026-03-26T10:00:00.000Z',
}

const area: AreaOfOperation = {
  id: 'ao-1',
  name: 'Northern Corridor',
  description: null,
  threat_level: 'amber',
  posture: 'defensive',
  posture_changed_at: null,
  color: '#ffaa00',
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  created_by: 'commander@example.com',
  created_at: '2026-03-26T10:00:00.000Z',
  updated_at: '2026-03-26T10:00:00.000Z',
}

const task: Task = {
  id: 'task-1',
  site_id: site.id,
  asset_id: null,
  title: 'Dispatch patrol',
  description: null,
  priority: 'high',
  workflow_status: 'in_progress',
  blocked_reason: null,
  resolved_at: null,
  created_at: '2026-03-26T10:00:00.000Z',
  updated_at: '2026-03-26T10:00:00.000Z',
  site_name: site.name,
  ao_id: area.id,
  ao_posture: area.posture,
}

const asset: Asset = {
  id: 'asset-1',
  name: 'Guardian-1',
  asset_type: 'vehicle',
  status: 'available',
  home_site_id: site.id,
  last_reported_at: null,
  created_at: '2026-03-26T10:00:00.000Z',
  updated_at: '2026-03-26T10:00:00.000Z',
}

const reading: TelemetryReading = {
  asset_id: asset.id,
  name: asset.name,
  lat: 51.55,
  lng: 0.18,
  heading: 180,
  speed: 14.2,
  battery: 82,
  ts: 1_711_000_000,
}

const disasterSignal: Signal = {
  id: 'sig-1',
  source: 'gdacs',
  signal_type: 'disaster_alert',
  external_id: 'gdacs-1',
  lat: 14.6,
  lng: 120.9,
  altitude: null,
  speed: null,
  heading: null,
  magnitude: 2.5,
  raw_payload: {
    alert_level: 'Red',
    event_type_name: 'Tropical Cyclone',
    country: 'Philippines',
  },
  occurred_at: '2026-03-26T12:00:00.000Z',
  ingested_at: '2026-03-26T12:01:00.000Z',
}

const vessel: Vessel = {
  id: 'vessel-1',
  mmsi: '123456789',
  name: 'MV Sentinel',
  vessel_type: 'Cargo',
  flag: 'PA',
  destination: 'Tangier',
  lat: 36.1,
  lng: -5.4,
  speed: 19,
  heading: 210,
  first_seen_at: '2026-03-25T00:00:00.000Z',
  last_seen_at: '2026-03-26T00:00:00.000Z',
  loitering_since: '2026-03-26T01:00:00.000Z',
  dark: true,
  loitering: true,
  last_signal_id: disasterSignal.id,
}

describe('GlobeInspectorPanel', () => {
  it('renders selected site detail, nearby signals, response assets, and tactical-map action', () => {
    const navigate = vi.fn()

    render(
      <GlobeInspectorPanel
        {...baseProps}
        selectedSite={site}
        selectedAreaOfOperation={area}
        selectedTasks={[task]}
        readiness={0.84}
        geofenceHits={1}
        nearestSignals={[{ signal: disasterSignal, distanceKm: 3.2 }]}
        nearestResponseAssets={[{ asset, reading, distanceKm: 4.1 }]}
        navigate={navigate}
      />,
    )

    expect(screen.getByText('84% ready')).toBeInTheDocument()
    expect(screen.getByText('Northern Corridor')).toBeInTheDocument()
    expect(screen.getByText(/1 of 1 nearest signals/)).toBeInTheDocument()
    expect(screen.getByText(/Inside geofence/)).toBeInTheDocument()
    expect(screen.getByText(/Guardian-1 · available/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /open tactical map/i }))
    expect(navigate).toHaveBeenCalledWith('/map?site_id=site-1')
  })

  it('renders selected asset telemetry and reconnecting state copy', () => {
    render(
      <GlobeInspectorPanel
        {...baseProps}
        selectedAsset={asset}
        selectedLiveReading={reading}
        telemetryConnected={false}
      />,
    )

    expect(screen.getByText('Telemetry reconnecting')).toBeInTheDocument()
    expect(screen.getByText('82%')).toBeInTheDocument()
    expect(screen.getByText(/14.2 m\/s/)).toBeInTheDocument()
    expect(screen.getByText(/S \(180°\)/)).toBeInTheDocument()
    expect(screen.getByText(/51.5500, 0.1800/)).toBeInTheDocument()
  })

  it('renders selected signal detail with vessel behavior tags and disaster metadata', () => {
    render(
      <GlobeInspectorPanel
        {...baseProps}
        selectedSignal={disasterSignal}
        selectedVessel={vessel}
      />,
    )

    expect(screen.getByText('disaster alert')).toBeInTheDocument()
    expect(screen.getByText('GDACS')).toBeInTheDocument()
    expect(screen.getByText('Red')).toBeInTheDocument()
    expect(screen.getByText('Loitering')).toBeInTheDocument()
    expect(screen.getByText('Loitering since')).toBeInTheDocument()
    expect(screen.getByText('Dark')).toBeInTheDocument()
    expect(screen.getByText('123456789')).toBeInTheDocument()
    expect(screen.getByText('Tropical Cyclone')).toBeInTheDocument()
    expect(screen.getByText('Philippines')).toBeInTheDocument()
    expect(screen.getByText('2.5')).toBeInTheDocument()
  })

  it('shows replay vessel context notice for vessel-position signals', () => {
    const vesselSignal: Signal = {
      ...disasterSignal,
      id: 'sig-vessel',
      source: 'ais',
      signal_type: 'vessel_position',
      external_id: '123456789',
      speed: 12,
      heading: 180,
      raw_payload: {
        mmsi: '123456789',
        vessel_type: 'Cargo',
        flag: 'PA',
        dest: 'Tangier',
      },
    }

    render(
      <GlobeInspectorPanel
        {...baseProps}
        isReplaying
        selectedSignal={vesselSignal}
        selectedVessel={vessel}
      />,
    )

    expect(screen.getByText(/reflect AIS history up to the replay timestamp/i)).toBeInTheDocument()
    expect(screen.getByText('123456789')).toBeInTheDocument()
  })
})
