import { formatBearingLineDegrees, parseBearingLineDegrees, parseBearingLineDistanceKm } from './mapBearingLine'
import { formatRangeRingInputValue, type RangeRingUnit } from './mapRangeRings'
import type { MapPoint } from './mapPoint'

export const DEFAULT_SECTOR_DEGREES_INPUT = '045'
export const DEFAULT_SECTOR_ARC_INPUT = '060'
export const DEFAULT_SECTOR_DISTANCE_INPUT = '20'

export function parseSectorDegrees(inputValue: string): number | null {
  return parseBearingLineDegrees(inputValue)
}

export function parseSectorArcDegrees(inputValue: string): number | null {
  const trimmed = inputValue.trim()
  if (trimmed.length === 0) return null

  const numericValue = Number(trimmed)
  if (!Number.isFinite(numericValue) || numericValue <= 0 || numericValue > 180) return null

  return Number(numericValue.toFixed(1))
}

export function parseSectorDistanceKm(
  inputValue: string,
  unit: RangeRingUnit,
): number | null {
  return parseBearingLineDistanceKm(inputValue, unit)
}

export function formatSectorDegrees(value: number): string {
  return formatBearingLineDegrees(value)
}

export function formatSectorArcDegrees(value: number): string {
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1)
  return `${rounded.replace(/\.0$/, '')}° ARC`
}

export function buildSectorFillFeatureCollection(
  anchor: MapPoint | null,
  bearingDegrees: number | null,
  arcDegrees: number | null,
  distanceKm: number | null,
): GeoJSON.FeatureCollection {
  if (!anchor || bearingDegrees === null || arcDegrees === null || distanceKm === null) {
    return { type: 'FeatureCollection', features: [] }
  }

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { id: 'sector-fill' },
      geometry: {
        type: 'Polygon',
        coordinates: [buildSectorCoordinates(anchor, bearingDegrees, arcDegrees, distanceKm)],
      },
    }],
  }
}

export function buildSectorOutlineFeatureCollection(
  anchor: MapPoint | null,
  bearingDegrees: number | null,
  arcDegrees: number | null,
  distanceKm: number | null,
): GeoJSON.FeatureCollection {
  if (!anchor || bearingDegrees === null || arcDegrees === null || distanceKm === null) {
    return { type: 'FeatureCollection', features: [] }
  }

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { id: 'sector-outline' },
      geometry: {
        type: 'LineString',
        coordinates: buildSectorCoordinates(anchor, bearingDegrees, arcDegrees, distanceKm),
      },
    }],
  }
}

export function buildSectorAnchorFeatureCollection(
  anchor: MapPoint | null,
): GeoJSON.FeatureCollection {
  if (!anchor) {
    return { type: 'FeatureCollection', features: [] }
  }

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { id: 'sector-anchor' },
      geometry: {
        type: 'Point',
        coordinates: [anchor.lng, anchor.lat],
      },
    }],
  }
}

export function buildSectorLabelFeatureCollection(
  anchor: MapPoint | null,
  bearingDegrees: number | null,
  arcDegrees: number | null,
  distanceKm: number | null,
  unit: RangeRingUnit,
): GeoJSON.FeatureCollection {
  if (!anchor || bearingDegrees === null || arcDegrees === null || distanceKm === null) {
    return { type: 'FeatureCollection', features: [] }
  }

  const labelPoint = projectPoint(anchor, distanceKm * 0.58, bearingDegrees)

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        id: 'sector-label',
        label: `${formatSectorDegrees(bearingDegrees)} · ${formatSectorArcDegrees(arcDegrees)} · ${formatRangeRingInputValue(distanceKm, unit)} ${unit.toUpperCase()}`,
      },
      geometry: {
        type: 'Point',
        coordinates: [labelPoint.lng, labelPoint.lat],
      },
    }],
  }
}

function buildSectorCoordinates(
  anchor: MapPoint,
  bearingDegrees: number,
  arcDegrees: number,
  distanceKm: number,
): [number, number][] {
  const halfArc = arcDegrees / 2
  const startBearing = bearingDegrees - halfArc
  const endBearing = bearingDegrees + halfArc
  const steps = Math.max(16, Math.ceil(arcDegrees / 6))
  const coordinates: [number, number][] = [[anchor.lng, anchor.lat]]

  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps
    const currentBearing = startBearing + (endBearing - startBearing) * progress
    const point = projectPoint(anchor, distanceKm, currentBearing)
    coordinates.push([point.lng, point.lat])
  }

  coordinates.push([anchor.lng, anchor.lat])
  return coordinates
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
