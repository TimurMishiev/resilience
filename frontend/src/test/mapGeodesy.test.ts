import { describe, expect, it } from 'vitest'
import { projectGeodesicPoint } from '../lib/mapGeodesy'

describe('mapGeodesy', () => {
  it('returns the original point for zero-distance projection', () => {
    const point = projectGeodesicPoint(
      { lat: 12.34, lng: 56.78 },
      0,
      270,
    )

    expect(point.lat).toBeCloseTo(12.34, 10)
    expect(point.lng).toBeCloseTo(56.78, 10)
  })

  it('projects a point along a geodesic bearing and normalizes longitude', () => {
    const point = projectGeodesicPoint(
      { lat: 37.7749, lng: -122.4194 },
      22.224,
      120,
    )

    expect(point.lat).toBeCloseTo(37.6748, 3)
    expect(point.lng).toBeCloseTo(-122.2007, 3)
  })

  it('treats 360 degrees as equivalent to 0 degrees', () => {
    const north = projectGeodesicPoint({ lat: 5, lng: 5 }, 10, 0)
    const wrapped = projectGeodesicPoint({ lat: 5, lng: 5 }, 10, 360)

    expect(wrapped.lat).toBeCloseTo(north.lat, 10)
    expect(wrapped.lng).toBeCloseTo(north.lng, 10)
  })

  it('wraps longitude when crossing the antimeridian eastbound', () => {
    const point = projectGeodesicPoint(
      { lat: 0, lng: 179.9 },
      25,
      90,
    )

    expect(point.lng).toBeLessThan(0)
    expect(point.lng).toBeGreaterThanOrEqual(-180)
  })

  it('crosses the equator cleanly on a southbound projection', () => {
    const point = projectGeodesicPoint(
      { lat: 0.1, lng: 30 },
      20,
      180,
    )

    expect(point.lat).toBeLessThan(0)
    expect(point.lng).toBeCloseTo(30, 3)
  })

  it('keeps coordinates finite and normalized near the pole', () => {
    const point = projectGeodesicPoint(
      { lat: 89.8, lng: 45 },
      30,
      0,
    )

    expect(Number.isFinite(point.lat)).toBe(true)
    expect(Number.isFinite(point.lng)).toBe(true)
    expect(point.lat).toBeLessThanOrEqual(90)
    expect(point.lng).toBeGreaterThanOrEqual(-180)
    expect(point.lng).toBeLessThanOrEqual(180)
  })
})
