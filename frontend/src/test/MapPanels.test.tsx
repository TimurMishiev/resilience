import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Asset, Signal, Site, SiteRiskScore, Task } from '../api/types'
import type { TelemetryReading } from '../lib/telemetry'
import type { Vessel, VesselTrack } from '../api/vessels'
import { MapAssetPanel } from '../components/MapAssetPanel'
import { MapSignalPanel } from '../components/MapSignalPanel'
import { MapSitePanel } from '../components/MapSitePanel'

vi.mock('../components/TaskRow', () => ({
  TaskRow: ({ task }: { task: Task }) => <li data-testid="task-row">{task.title}</li>,
}))

vi.mock('../components/MapSiteAlertsSection', () => ({
  MapSiteAlertsSection: () => <div data-testid="map-site-alerts-stub" />,
}))

const baseSite: Site = {
  id: 'site-1',
  name: 'Site Alpha',
  latitude: 51.5,
  longitude: 0.12,
  status: 'active',
  area_of_operation_id: null,
  flagged_at: null,
  flag_reason: null,
  geofence_radius_km: 10,
  created_at: '2026-03-26T10:00:00.000Z',
  updated_at: '2026-03-26T10:00:00.000Z',
}

const task: Task = {
  id: 'task-1',
  site_id: 'site-1',
  asset_id: null,
  title: 'Investigate perimeter breach',
  description: null,
  priority: 'high',
  workflow_status: 'blocked',
  blocked_reason: 'Awaiting drone feed',
  resolved_at: null,
  created_at: '2026-03-26T10:00:00.000Z',
  updated_at: '2026-03-26T10:00:00.000Z',
  site_name: 'Site Alpha',
  ao_id: null,
  ao_posture: null,
}

const risk: SiteRiskScore = {
  site_id: 'site-1',
  site_name: 'Site Alpha',
  score: 91,
  risk_level: 'critical',
  components: {
    alert_pressure: 3.2,
    task_health: 1.7,
    signal_density: 4.9,
  },
  computed_at: '2026-03-26T10:00:00.000Z',
}

const asset: Asset = {
  id: 'asset-1',
  name: 'Guardian-1',
  asset_type: 'vehicle',
  status: 'assigned',
  home_site_id: 'site-1',
  last_reported_at: null,
  created_at: '2026-03-26T10:00:00.000Z',
  updated_at: '2026-03-26T10:00:00.000Z',
}

const reading: TelemetryReading = {
  asset_id: 'asset-1',
  name: 'Guardian-1',
  lat: 51.51,
  lng: 0.13,
  heading: 90,
  speed: 12.4,
  battery: 37,
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
  magnitude: 2.7,
  raw_payload: {
    name: 'Cyclone Vesper',
    alert_level: 'Red',
    event_type_name: 'Tropical Cyclone',
    country: 'Philippines',
    severity_text: 'Extreme',
  },
  occurred_at: '2026-03-26T12:00:00.000Z',
  ingested_at: '2026-03-26T12:01:00.000Z',
}

const vesselSignal: Signal = {
  id: 'sig-2',
  source: 'ais',
  signal_type: 'vessel_position',
  external_id: '123456789',
  lat: 36.1,
  lng: -5.4,
  altitude: null,
  speed: 18,
  heading: 220,
  magnitude: null,
  raw_payload: {},
  occurred_at: '2026-03-26T14:00:00.000Z',
  ingested_at: '2026-03-26T14:01:00.000Z',
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
  speed: 18,
  heading: 220,
  first_seen_at: '2026-03-25T00:00:00.000Z',
  last_seen_at: '2026-03-26T00:00:00.000Z',
  loitering_since: '2026-03-26T01:00:00.000Z',
  loitering: true,
  dark: true,
  last_signal_id: vesselSignal.id,
}

const vesselTracks: VesselTrack[] = [
  { id: 'track-1', lat: 36.0, lng: -5.5, speed: 16, heading: 210, occurred_at: '2026-03-25T00:00:00.000Z' },
  { id: 'track-2', lat: 36.1, lng: -5.4, speed: 18, heading: 220, occurred_at: '2026-03-26T00:00:00.000Z' },
]

describe('map data panels', () => {
  it('renders site state, readiness, risk, replay notice, and tasks', () => {
    const onClose = vi.fn()

    render(
      <MapSitePanel
        site={baseSite}
        tasks={[task]}
        readiness={0.76}
        riskBySiteId={{ [baseSite.id]: risk }}
        isReplaying
        role="commander"
        canTriage
        referenceTimeMs={Date.parse('2026-03-26T12:00:00Z')}
        onTransitioned={() => {}}
        onClose={onClose}
      />,
    )

    expect(screen.getByText('Site Alpha')).toBeInTheDocument()
    expect(screen.getByText('1 task')).toBeInTheDocument()
    expect(screen.getByText('76% ready')).toBeInTheDocument()
    expect(screen.getByText('RISK CRIT 91')).toBeInTheDocument()
    expect(screen.getByText(/Replay mode/i)).toBeInTheDocument()
    expect(screen.getByTestId('task-row')).toHaveTextContent('Investigate perimeter breach')

    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders asset telemetry when live data exists and replay fallback copy when it does not', () => {
    const { rerender } = render(
      <MapAssetPanel
        asset={asset}
        liveReading={reading}
        isReplaying={false}
        onClose={() => {}}
      />,
    )

    expect(screen.getByText(/Guardian-1/, { selector: '.map-panel-title' })).toBeInTheDocument()
    expect(screen.getByText('37%')).toBeInTheDocument()
    expect(screen.getByText(/12.4 m\/s/)).toBeInTheDocument()
    expect(screen.getByText(/E \(90°\)/)).toBeInTheDocument()
    expect(screen.getByText(/51.5100, 0.1300/)).toBeInTheDocument()

    rerender(
      <MapAssetPanel
        asset={asset}
        liveReading={null}
        isReplaying
        onClose={() => {}}
      />,
    )

    expect(screen.getByText(/No telemetry snapshot available for this replay time/i)).toBeInTheDocument()
  })

  it('renders disaster alert detail with custom title and alert metadata', () => {
    render(
      <MapSignalPanel
        signal={disasterSignal}
        vessel={null}
        vesselTracks={[]}
        isReplaying={false}
        onClose={() => {}}
      />,
    )

    expect(screen.getByText('Cyclone Vesper')).toBeInTheDocument()
    expect(screen.getByText('disaster alert')).toBeInTheDocument()
    expect(screen.getByText('GDACS')).toBeInTheDocument()
    expect(screen.getByText('Red')).toBeInTheDocument()
    expect(screen.getByText('Tropical Cyclone')).toBeInTheDocument()
    expect(screen.getByText('Philippines')).toBeInTheDocument()
    expect(screen.getByText('Extreme')).toBeInTheDocument()
    expect(screen.getByText(/2.7 \/ 3.0/)).toBeInTheDocument()
  })

  it('renders vessel identity, behavior tags, track summary, and replay warning', () => {
    render(
      <MapSignalPanel
        signal={vesselSignal}
        vessel={vessel}
        vesselTracks={vesselTracks}
        isReplaying
        onClose={() => {}}
      />,
    )

    expect(screen.getByText('MV Sentinel')).toBeInTheDocument()
    expect(screen.getByText('Loitering')).toBeInTheDocument()
    expect(screen.getByText('Loitering since')).toBeInTheDocument()
    expect(screen.getByText('Dark')).toBeInTheDocument()
    expect(screen.getByText('123456789')).toBeInTheDocument()
    expect(screen.getByText('Cargo')).toBeInTheDocument()
    expect(screen.getByText('Tangier')).toBeInTheDocument()
    expect(screen.getByText(/2 pts/)).toBeInTheDocument()
    expect(screen.getByText(/reflect AIS history up to the replay timestamp/i)).toBeInTheDocument()
  })
})
