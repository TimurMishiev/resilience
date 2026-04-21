import { formatRangeRingInputValue, rangeRingUnitToKm, type RangeRingUnit } from './mapRangeRings'
import type { MapPoint } from './mapPoint'

export const DEFAULT_BEARING_LINE_DEGREES_INPUT = '045'
export const DEFAULT_BEARING_LINE_DISTANCE_INPUT = '20'

export function parseBearingLineDegrees(inputValue: string): number | null {
  const trimmed = inputValue.trim()
  if (trimmed.length === 0) return null

  const numericValue = Number(trimmed)
  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 360) return null

  return numericValue === 360 ? 0 : Number(numericValue.toFixed(1))
}

export function parseBearingLineDistanceKm(
  inputValue: string,
  unit: RangeRingUnit,
): number | null {
  const trimmed = inputValue.trim()
  if (trimmed.length === 0) return null

  const numericValue = Number(trimmed)
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null

  return Number(rangeRingUnitToKm(numericValue, unit).toFixed(3))
}

export function formatBearingLineDegrees(value: number): string {
  return `${String(Math.round(((value % 360) + 360) % 360)).padStart(3, '0')}°`
}

export function buildBearingLineFeatureCollection(
  anchor: MapPoint | null,
  bearingDegrees: number | null,
  distanceKm: number | null,
): GeoJSON.FeatureCollection {
  if (!anchor || bearingDegrees === null || distanceKm === null) {
    return { type: 'FeatureCollection', features: [] }
  }

  const endpoint = projectPoint(anchor, distanceKm, bearingDegrees)

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { id: 'bearing-line' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [anchor.lng, anchor.lat],
          [endpoint.lng, endpoint.lat],
        ],
      },
    }],
  }
}

export function buildBearingLinePointFeatureCollection(
  anchor: MapPoint | null,
  bearingDegrees: number | null,
  distanceKm: number | null,
): GeoJSON.FeatureCollection {
  if (!anchor) {
    return { type: 'FeatureCollection', features: [] }
  }

  const features: GeoJSON.Feature[] = [{
    type: 'Feature',
    properties: { id: 'bearing-anchor', kind: 'anchor' },
    geometry: {
      type: 'Point',
      coordinates: [anchor.lng, anchor.lat],
    },
  }]

  if (bearingDegrees !== null && distanceKm !== null) {
    const endpoint = projectPoint(anchor, distanceKm, bearingDegrees)
    features.push({
      type: 'Feature',
      properties: { id: 'bearing-endpoint', kind: 'endpoint' },
      geometry: {
        type: 'Point',
        coordinates: [endpoint.lng, endpoint.lat],
      },
    })
  }

  return {
    type: 'FeatureCollection',
    features,
  }
}

export function buildBearingLineLabelFeatureCollection(
  anchor: MapPoint | null,
  bearingDegrees: number | null,
  distanceKm: number | null,
  unit: RangeRingUnit,
): GeoJSON.FeatureCollection {
  if (!anchor || bearingDegrees === null || distanceKm === null) {
    return { type: 'FeatureCollection', features: [] }
  }

  const endpoint = projectPoint(anchor, distanceKm, bearingDegrees)

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        id: 'bearing-line-label',
        label: `${formatBearingLineDegrees(bearingDegrees)} · ${formatRangeRingInputValue(distanceKm, unit)} ${unit.toUpperCase()}`,
      },
      geometry: {
        type: 'Point',
        coordinates: [endpoint.lng, endpoint.lat],
      },
    }],
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
