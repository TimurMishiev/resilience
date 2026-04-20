import { describe, expect, it } from 'vitest'
import {
  buildMeasurementLineFeatureCollection,
  buildMeasurementPointFeatureCollection,
  measurementBearingCardinal,
  measurementBearingDegrees,
  measurementDistanceKm,
} from '../lib/mapMeasurement'

describe('mapMeasurement', () => {
  it('computes eastbound distance and bearing for an equatorial leg', () => {
    const start = { lat: 0, lng: 0 }
    const end = { lat: 0, lng: 1 }

    expect(measurementDistanceKm(start, end)).toBeCloseTo(111.2, 1)
    expect(measurementBearingDegrees(start, end)).toBeCloseTo(90, 3)
    expect(measurementBearingCardinal(90)).toBe('E')
  })

  it('builds labeled point features and a line for a complete measurement', () => {
    const points = [
      { lat: 37.7749, lng: -122.4194 },
      { lat: 34.0522, lng: -118.2437 },
    ]

    expect(buildMeasurementPointFeatureCollection(points)).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { label: 'A', role: 'anchor' },
          geometry: { type: 'Point', coordinates: [-122.4194, 37.7749] },
        },
        {
          type: 'Feature',
          properties: { label: 'B', role: 'target' },
          geometry: { type: 'Point', coordinates: [-118.2437, 34.0522] },
        },
      ],
    })

    expect(buildMeasurementLineFeatureCollection(points)).toEqual({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [-122.4194, 37.7749],
            [-118.2437, 34.0522],
          ],
        },
      }],
    })
  })

  it('returns an empty line collection until two points exist', () => {
    expect(buildMeasurementLineFeatureCollection([{ lat: 37.7749, lng: -122.4194 }])).toEqual({
      type: 'FeatureCollection',
      features: [],
    })
  })
})
