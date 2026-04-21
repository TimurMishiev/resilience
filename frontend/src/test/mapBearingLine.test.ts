import { describe, expect, it } from 'vitest'
import {
  buildBearingLineLabelFeatureCollection,
  formatBearingLineDegrees,
  parseBearingLineDegrees,
  parseBearingLineDistanceKm,
} from '../lib/mapBearingLine'

describe('mapBearingLine', () => {
  it('parses bearing degrees and distance inputs into renderable values', () => {
    expect(parseBearingLineDegrees('045')).toBe(45)
    expect(parseBearingLineDegrees('360')).toBe(0)
    expect(parseBearingLineDegrees('361')).toBeNull()
    expect(parseBearingLineDistanceKm('12', 'nm')).toBe(22.224)
    expect(parseBearingLineDistanceKm('8', 'km')).toBe(8)
  })

  it('formats bearing labels for endpoint rendering', () => {
    expect(formatBearingLineDegrees(45)).toBe('045°')
    expect(formatBearingLineDegrees(0)).toBe('000°')

    const labels = buildBearingLineLabelFeatureCollection(
      { lat: 37.7749, lng: -122.4194 },
      120,
      22.224,
      'nm',
    )

    expect(labels.features).toHaveLength(1)
    expect(labels.features[0]).toMatchObject({
      properties: { label: '120° · 12 NM' },
      geometry: { type: 'Point' },
    })
  })
})
