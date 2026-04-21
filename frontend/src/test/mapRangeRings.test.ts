import { describe, expect, it } from 'vitest'
import {
  buildRangeRingLabelFeatureCollection,
  convertRangeRingInputValue,
  formatRangeRingInputValue,
  parseRangeRingInputs,
} from '../lib/mapRangeRings'

describe('mapRangeRings', () => {
  it('parses positive inputs into kilometer radii using the active display unit', () => {
    expect(parseRangeRingInputs(['5', '10', '', 'abc'], 'nm')).toEqual([9.26, 18.52])
    expect(parseRangeRingInputs(['3', '12.5'], 'km')).toEqual([3, 12.5])
  })

  it('converts range-ring input values between nautical miles and kilometers', () => {
    expect(convertRangeRingInputValue('8', 'nm', 'km')).toBe('14.8')
    expect(convertRangeRingInputValue('18.5', 'km', 'nm')).toBe('9.99')
    expect(convertRangeRingInputValue('', 'nm', 'km')).toBe('')
  })

  it('builds ring labels in the active display unit', () => {
    const labels = buildRangeRingLabelFeatureCollection(
      { lat: 37.7749, lng: -122.4194 },
      [9.26, 18.52],
      'nm',
    )

    expect(labels.features).toHaveLength(2)
    expect(labels.features[0]).toMatchObject({
      properties: { label: '5 NM' },
      geometry: { type: 'Point' },
    })
    expect(formatRangeRingInputValue(18.52, 'nm')).toBe('10')
  })
})
