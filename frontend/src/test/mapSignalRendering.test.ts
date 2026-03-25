import { describe, expect, it } from 'vitest'
import type { Signal } from '../api/types'
import { buildMapSignalRenderCollections } from '../lib/mapSignalRendering'

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
