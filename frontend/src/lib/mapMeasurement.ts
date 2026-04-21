import { haversineKm } from './coverage'
import type { MapPoint } from './mapPoint'

export function measurementDistanceKm(
  start: MapPoint,
  end: MapPoint,
): number {
  return haversineKm(start.lat, start.lng, end.lat, end.lng)
}

export function measurementBearingDegrees(
  start: MapPoint,
  end: MapPoint,
): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const toDeg = (radians: number) => (radians * 180) / Math.PI

  const lat1 = toRad(start.lat)
  const lat2 = toRad(end.lat)
  const dLng = toRad(end.lng - start.lng)

  const y = Math.sin(dLng) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)

  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

export function measurementBearingCardinal(bearingDegrees: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
  return directions[Math.round(bearingDegrees / 45) % directions.length]!
}

export function buildMeasurementPointFeatureCollection(
  points: MapPoint[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((point, index) => ({
      type: 'Feature',
      properties: {
        label: index === 0 ? 'A' : 'B',
        role: index === 0 ? 'anchor' : 'target',
      },
      geometry: {
        type: 'Point',
        coordinates: [point.lng, point.lat],
      },
    })),
  }
}

export function buildMeasurementLineFeatureCollection(
  points: MapPoint[],
): GeoJSON.FeatureCollection {
  if (points.length < 2) {
    return {
      type: 'FeatureCollection',
      features: [],
    }
  }

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: points.slice(0, 2).map(point => [point.lng, point.lat]),
      },
    }],
  }
}
