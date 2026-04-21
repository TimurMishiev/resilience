import { circlePolygon } from './coverage'
import type { MapPoint } from './mapPoint'

export type RangeRingUnit = 'km' | 'nm'

export const DEFAULT_RANGE_RING_UNIT: RangeRingUnit = 'nm'
export const DEFAULT_RANGE_RING_INPUTS = ['5', '10', '20'] as const

export function rangeRingUnitToKm(value: number, unit: RangeRingUnit): number {
  return unit === 'km' ? value : value * 1.852
}

export function rangeRingKmToUnit(valueKm: number, unit: RangeRingUnit): number {
  return unit === 'km' ? valueKm : valueKm / 1.852
}

export function formatRangeRingInputValue(valueKm: number, unit: RangeRingUnit): string {
  const displayValue = rangeRingKmToUnit(valueKm, unit)
  const rounded = displayValue >= 10 ? displayValue.toFixed(1) : displayValue.toFixed(2)
  return rounded.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')
}

export function convertRangeRingInputValue(
  inputValue: string,
  fromUnit: RangeRingUnit,
  toUnit: RangeRingUnit,
): string {
  const trimmed = inputValue.trim()
  if (trimmed.length === 0) return ''

  const numericValue = Number(trimmed)
  if (!Number.isFinite(numericValue) || numericValue <= 0) return inputValue

  return formatRangeRingInputValue(rangeRingUnitToKm(numericValue, fromUnit), toUnit)
}

export function parseRangeRingInputs(
  inputValues: string[],
  unit: RangeRingUnit,
): number[] {
  return inputValues.flatMap(inputValue => {
    const numericValue = Number(inputValue.trim())
    if (!Number.isFinite(numericValue) || numericValue <= 0) return []
    return [Number(rangeRingUnitToKm(numericValue, unit).toFixed(3))]
  })
}

export function buildRangeRingAnchorFeatureCollection(
  anchor: MapPoint | null,
): GeoJSON.FeatureCollection {
  if (!anchor) {
    return { type: 'FeatureCollection', features: [] }
  }

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { label: 'CENTER' },
      geometry: {
        type: 'Point',
        coordinates: [anchor.lng, anchor.lat],
      },
    }],
  }
}

export function buildRangeRingLineFeatureCollection(
  anchor: MapPoint | null,
  radiiKm: number[],
): GeoJSON.FeatureCollection {
  if (!anchor || radiiKm.length === 0) {
    return { type: 'FeatureCollection', features: [] }
  }

  return {
    type: 'FeatureCollection',
    features: radiiKm.map((radiusKm, index) => {
      const polygon = circlePolygon(anchor.lat, anchor.lng, radiusKm)
      const coordinates = polygon.geometry.type === 'Polygon'
        ? polygon.geometry.coordinates[0] ?? []
        : []

      return {
        type: 'Feature',
        properties: {
          id: `range-ring-${index + 1}`,
        },
        geometry: {
          type: 'LineString',
          coordinates,
        },
      }
    }),
  }
}

export function buildRangeRingLabelFeatureCollection(
  anchor: MapPoint | null,
  radiiKm: number[],
  unit: RangeRingUnit,
): GeoJSON.FeatureCollection {
  if (!anchor || radiiKm.length === 0) {
    return { type: 'FeatureCollection', features: [] }
  }

  return {
    type: 'FeatureCollection',
    features: radiiKm.map((radiusKm, index) => {
      const labelPoint = projectPoint(anchor, radiusKm, 90)
      return {
        type: 'Feature',
        properties: {
          id: `range-ring-label-${index + 1}`,
          label: `${formatRangeRingInputValue(radiusKm, unit)} ${unit.toUpperCase()}`,
        },
        geometry: {
          type: 'Point',
          coordinates: [labelPoint.lng, labelPoint.lat],
        },
      }
    }),
  }
}

function projectPoint(
  start: MapPoint,
  distanceKm: number,
  bearingDegrees: number,
): MapPoint {
  const earthRadiusKm = 6371
  const angularDistance = distanceKm / earthRadiusKm
  const bearing = (bearingDegrees * Math.PI) / 180
  const startLat = (start.lat * Math.PI) / 180
  const startLng = (start.lng * Math.PI) / 180

  const projectedLat = Math.asin(
    Math.sin(startLat) * Math.cos(angularDistance) +
      Math.cos(startLat) * Math.sin(angularDistance) * Math.cos(bearing),
  )

  const projectedLng = startLng + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(startLat),
    Math.cos(angularDistance) - Math.sin(startLat) * Math.sin(projectedLat),
  )

  return {
    lat: (projectedLat * 180) / Math.PI,
    lng: ((projectedLng * 180) / Math.PI + 540) % 360 - 180,
  }
}
