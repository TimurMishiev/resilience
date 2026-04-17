import { describe, expect, it } from 'vitest'
import type { Signal } from '../api/types'
import { buildMapSignalFeatureCollection, buildMapSignalRenderCollections } from '../lib/mapSignalRendering'

function makeSignal(overrides: Partial<Signal> & Pick<Signal, 'id' | 'signal_type' | 'source'>): Signal {
  return {
    id: overrides.id,
    signal_type: overrides.signal_type,
    source: overrides.source,
    lat: overrides.lat ?? 10,
    lng: overrides.lng ?? 20,
    occurred_at: overrides.occurred_at ?? '2026-03-24T00:00:00Z',
    ingested_at: overrides.ingested_at ?? '2026-03-24T00:00:05Z',
    external_id: overrides.external_id ?? '',
    magnitude: overrides.magnitude ?? null,
    altitude: overrides.altitude ?? null,
    speed: overrides.speed ?? null,
    heading: overrides.heading ?? null,
    raw_payload: overrides.raw_payload ?? {},
  }
}

describe('buildMapSignalRenderCollections', () => {
  it('keeps the selected signal out of the clusterable collection', () => {
    const signals = [
      makeSignal({ id: 'sig-1', signal_type: 'disaster_alert', source: 'gdacs' }),
      makeSignal({ id: 'sig-2', signal_type: 'vessel_position', source: 'ais' }),
    ]

    const collections = buildMapSignalRenderCollections(signals, 'sig-2')

    expect(collections.clusterable.features).toHaveLength(1)
    expect(collections.clusterable.features[0]?.properties?.id).toBe('sig-1')
    expect(collections.selected.features).toHaveLength(1)
    expect(collections.selected.features[0]?.properties?.id).toBe('sig-2')
  })

  it('keeps all signals clusterable when the selected signal is missing', () => {
    const signals = [
      makeSignal({ id: 'sig-1', signal_type: 'disaster_alert', source: 'gdacs' }),
      makeSignal({ id: 'sig-2', signal_type: 'vessel_position', source: 'ais' }),
    ]

    const collections = buildMapSignalRenderCollections(signals, 'sig-99')

    expect(collections.clusterable.features).toHaveLength(2)
    expect(collections.selected.features).toHaveLength(0)
  })

  it('keeps all signals clusterable when nothing is selected', () => {
    const signals = [
      makeSignal({ id: 'sig-1', signal_type: 'disaster_alert', source: 'gdacs' }),
    ]

    const collections = buildMapSignalRenderCollections(signals, null)

    expect(collections.clusterable.features).toHaveLength(1)
    expect(collections.selected.features).toHaveLength(0)
  })
})

describe('signal freshness on map features', () => {
  const referenceTimeMs = Date.parse('2026-04-17T12:00:00Z')

  it('classifies a recent signal as fresh', () => {
    const signals = [
      makeSignal({
        id: 'sig-fresh',
        signal_type: 'vessel_position',
        source: 'ais',
        occurred_at: '2026-04-17T11:30:00Z',
      }),
    ]
    const fc = buildMapSignalFeatureCollection(signals, referenceTimeMs)
    expect(fc.features[0]?.properties?.freshness).toBe('fresh')
  })

  it('classifies a signal older than 2h as aging', () => {
    const signals = [
      makeSignal({
        id: 'sig-aging',
        signal_type: 'aircraft_position',
        source: 'opensky',
        occurred_at: '2026-04-17T09:00:00Z',
      }),
    ]
    const fc = buildMapSignalFeatureCollection(signals, referenceTimeMs)
    expect(fc.features[0]?.properties?.freshness).toBe('aging')
  })

  it('classifies a signal older than 12h as stale', () => {
    const signals = [
      makeSignal({
        id: 'sig-stale',
        signal_type: 'seismic_event',
        source: 'usgs_seismic',
        occurred_at: '2026-04-16T23:00:00Z',
      }),
    ]
    const fc = buildMapSignalFeatureCollection(signals, referenceTimeMs)
    expect(fc.features[0]?.properties?.freshness).toBe('stale')
  })

  it('marks a signal with an invalid timestamp as unavailable', () => {
    const signals = [
      makeSignal({
        id: 'sig-bad',
        signal_type: 'vessel_position',
        source: 'ais',
        occurred_at: 'garbage',
      }),
    ]
    const fc = buildMapSignalFeatureCollection(signals, referenceTimeMs)
    expect(fc.features[0]?.properties?.freshness).toBe('unavailable')
  })

  it('propagates freshness to both clusterable and selected collections', () => {
    const signals = [
      makeSignal({
        id: 'sig-sel',
        signal_type: 'disaster_alert',
        source: 'gdacs',
        occurred_at: '2026-04-17T11:00:00Z',
      }),
      makeSignal({
        id: 'sig-clust',
        signal_type: 'conflict_event',
        source: 'acled',
        occurred_at: '2026-04-16T20:00:00Z',
      }),
    ]
    const collections = buildMapSignalRenderCollections(signals, 'sig-sel', referenceTimeMs)
    expect(collections.selected.features[0]?.properties?.freshness).toBe('fresh')
    expect(collections.clusterable.features[0]?.properties?.freshness).toBe('stale')
  })
})
