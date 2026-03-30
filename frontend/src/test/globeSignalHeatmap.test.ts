import { describe, expect, it } from 'vitest'
import { buildGlobeSignalHeatmapCells } from '../lib/globeSignalHeatmap'
import type { Signal } from '../api/types'

function makeSignal(id: string, lat: number, lng: number, signalType: Signal['signal_type'] = 'manual'): Signal {
  return {
    id,
    source: 'manual',
    signal_type: signalType,
    external_id: id,
    lat: String(lat),
    lng: String(lng),
    altitude: null,
    speed: null,
    heading: null,
    magnitude: null,
    raw_payload: {},
    occurred_at: '2026-03-30T00:00:00Z',
    ingested_at: '2026-03-30T00:00:01Z',
  }
}

describe('buildGlobeSignalHeatmapCells', () => {
  it('aggregates nearby signals into a single cell and normalizes intensity', () => {
    const cells = buildGlobeSignalHeatmapCells([
      makeSignal('s1', 10.1, 20.1),
      makeSignal('s2', 10.4, 20.3),
      makeSignal('s3', 40, 60, 'seismic_event'),
    ])

    expect(cells).toHaveLength(2)
    expect(cells[0]).toMatchObject({
      count: 2,
      weight: 2,
      intensity: 1,
    })
    expect(cells[1].count).toBe(1)
    expect(cells[1].weight).toBe(1.3)
    expect(cells[1].intensity).toBeCloseTo(0.65, 2)
  })

  it('normalizes longitudes into stable bucket keys across the dateline', () => {
    const cells = buildGlobeSignalHeatmapCells([
      makeSignal('east', 5, 181),
      makeSignal('west', 5, -179),
    ])

    expect(cells).toHaveLength(1)
    expect(cells[0]).toMatchObject({
      count: 2,
      weight: 2,
      intensity: 1,
    })
  })
})
