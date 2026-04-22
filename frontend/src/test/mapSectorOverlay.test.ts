import { describe, expect, it } from 'vitest'
import {
  buildSectorFillFeatureCollection,
  buildSectorLabelFeatureCollection,
  formatSectorArcDegrees,
  formatSectorDegrees,
  parseSectorArcDegrees,
  parseSectorDegrees,
  parseSectorDistanceKm,
} from '../lib/mapSectorOverlay'

describe('mapSectorOverlay', () => {
  it('parses heading, arc, and distance inputs into renderable values', () => {
    expect(parseSectorDegrees('045')).toBe(45)
    expect(parseSectorDegrees('360')).toBe(0)
    expect(parseSectorDegrees('361')).toBeNull()
    expect(parseSectorArcDegrees('60')).toBe(60)
    expect(parseSectorArcDegrees('181')).toBeNull()
    expect(parseSectorDistanceKm('12', 'nm')).toBe(22.224)
    expect(parseSectorDistanceKm('8', 'km')).toBe(8)
  })

  it('formats labels and builds renderable sector geometry', () => {
    expect(formatSectorDegrees(45)).toBe('045°')
    expect(formatSectorArcDegrees(60)).toBe('60° ARC')

    const fill = buildSectorFillFeatureCollection(
      { lat: 37.7749, lng: -122.4194 },
      45,
      60,
      22.224,
    )
    const labels = buildSectorLabelFeatureCollection(
      { lat: 37.7749, lng: -122.4194 },
      45,
      60,
      22.224,
      'nm',
    )

    expect(fill.features).toHaveLength(1)
    expect(fill.features[0]).toMatchObject({
      geometry: { type: 'Polygon' },
    })
    expect(labels.features).toHaveLength(1)
    expect(labels.features[0]).toMatchObject({
      properties: { label: '045° · 60° ARC · 12 NM' },
      geometry: { type: 'Point' },
    })
  })
})
