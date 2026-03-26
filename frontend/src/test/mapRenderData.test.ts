import { describe, expect, it } from 'vitest'
import type { Asset, Site, Task } from '../api/types'
import type { TelemetryReading } from '../lib/telemetry'
import {
  buildAssetFeatureCollection,
  buildSignalPopupContent,
  buildSiteFeatureCollection,
  siteHealthColor,
  siteHealthKey,
} from '../lib/mapRenderData'

const baseSite: Site = {
  id: 'site-1',
  name: 'Site Alpha',
  latitude: '51.5000',
  longitude: '0.1200',
  status: 'active',
  area_of_operation_id: null,
  flagged_at: null,
  flag_reason: null,
  geofence_radius_km: 25,
  created_at: '2026-03-26T10:00:00.000Z',
  updated_at: '2026-03-26T10:00:00.000Z',
}

function makeTask(id: string, status: Task['workflow_status']): Task {
  return {
    id,
    site_id: baseSite.id,
    asset_id: null,
    title: `Task ${id}`,
    description: null,
    priority: 'normal',
    workflow_status: status,
    blocked_reason: null,
    resolved_at: null,
    created_at: '2026-03-26T10:00:00.000Z',
    updated_at: '2026-03-26T10:00:00.000Z',
    site_name: baseSite.name,
    ao_id: null,
    ao_posture: null,
  }
}

function makeAsset(id: string, type: Asset['asset_type']): Asset {
  return {
    id,
    name: `Asset ${id}`,
    asset_type: type,
    status: 'available',
    home_site_id: baseSite.id,
    last_reported_at: null,
    created_at: '2026-03-26T10:00:00.000Z',
    updated_at: '2026-03-26T10:00:00.000Z',
  }
}

describe('mapRenderData', () => {
  it('derives site health keys and colors from task state and site status', () => {
    expect(siteHealthKey([], 'active')).toBe('active')
    expect(siteHealthKey([makeTask('task-1', 'blocked')], 'active')).toBe('blocked')
    expect(siteHealthKey([makeTask('task-2', 'resolved')], 'active')).toBe('resolved')
    expect(siteHealthKey([makeTask('task-3', 'in_progress')], 'active')).toBe('in_progress')
    expect(siteHealthKey([], 'inactive')).toBe('inactive')

    expect(siteHealthColor('blocked')).toBe('#ff5c5c')
    expect(siteHealthColor('inactive')).toBe('#6b7280')
  })

  it('builds site features with health and deterministic coordinates', () => {
    const collection = buildSiteFeatureCollection([baseSite], {
      [baseSite.id]: [makeTask('task-1', 'blocked')],
    })

    expect(collection.features).toHaveLength(1)
    expect(collection.features[0]?.properties).toMatchObject({
      id: baseSite.id,
      name: baseSite.name,
      health: 'blocked',
      color: '#ff5c5c',
    })
    expect(collection.features[0]?.geometry).toEqual({
      type: 'Point',
      coordinates: [0.12, 51.5],
    })
  })

  it('uses live telemetry for asset features and falls back to seeded home-site positions otherwise', () => {
    const liveReading: TelemetryReading = {
      asset_id: 'asset-1',
      name: 'Asset asset-1',
      lat: 48.1,
      lng: 2.3,
      heading: 90,
      speed: 20,
      battery: 80,
      ts: Date.now() / 1000,
    }
    const staleReading: TelemetryReading = {
      ...liveReading,
      asset_id: 'asset-2',
      lat: 42.2,
      lng: 7.7,
      ts: 0,
    }

    const liveCollection = buildAssetFeatureCollection(
      [makeAsset('asset-1', 'vehicle')],
      [baseSite],
      new Map([['asset-1', liveReading]]),
    )
    expect(liveCollection.features[0]?.geometry).toEqual({
      type: 'Point',
      coordinates: [2.3, 48.1],
    })
    expect(liveCollection.features[0]?.properties).toMatchObject({
      id: 'asset-1',
      icon: 'V',
    })

    const seededCollection = buildAssetFeatureCollection(
      [makeAsset('asset-2', 'equipment')],
      [baseSite],
      new Map([['asset-2', staleReading]]),
    )
    expect(seededCollection.features[0]?.geometry).not.toEqual({
      type: 'Point',
      coordinates: [7.7, 42.2],
    })

    const historicalCollection = buildAssetFeatureCollection(
      [makeAsset('asset-2', 'equipment')],
      [baseSite],
      new Map([['asset-2', staleReading]]),
      true,
    )
    expect(historicalCollection.features[0]?.geometry).toEqual({
      type: 'Point',
      coordinates: [7.7, 42.2],
    })
  })

  it('renders disaster alert popup content with source, alert, and severity detail', () => {
    const popup = buildSignalPopupContent({
      signal_type: 'disaster_alert',
      source: 'gdacs',
      p_name: 'Cyclone Vesper',
      p_event_type_name: 'Tropical Cyclone',
      p_country: 'Philippines',
      p_alert_level: 'Red',
      p_severity_text: 'Extreme',
      occurred_at: '2026-03-26T12:00:00.000Z',
    })

    expect(popup.textContent).toContain('Cyclone Vesper')
    expect(popup.textContent).toContain('GDACS')
    expect(popup.textContent).toContain('Tropical Cyclone')
    expect(popup.textContent).toContain('Philippines')
    expect(popup.textContent).toContain('Red')
    expect(popup.textContent).toContain('Extreme')
    expect(popup.textContent).toContain('Click for details')
  })

  it('renders conflict-event and generic signal popup detail branches', () => {
    const conflict = buildSignalPopupContent({
      signal_type: 'conflict_event',
      source: 'acled',
      p_country: 'Sudan',
      p_actor1: 'SAF',
      p_fatalities: '12',
      occurred_at: '2026-03-26T12:00:00.000Z',
    })
    expect(conflict.textContent).toContain('Sudan')
    expect(conflict.textContent).toContain('SAF')
    expect(conflict.textContent).toContain('12')

    const aircraft = buildSignalPopupContent({
      signal_type: 'aircraft_position',
      source: 'opensky',
      magnitude: '2.1',
      altitude: '12000',
      speed: '430',
      occurred_at: '2026-03-26T12:00:00.000Z',
    })
    expect(aircraft.textContent).toContain('Magnitude')
    expect(aircraft.textContent).toContain('12000 m')
    expect(aircraft.textContent).toContain('430 kn')
  })
})
