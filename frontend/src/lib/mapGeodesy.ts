import type { MapPoint } from './mapPoint'

export function projectGeodesicPoint(
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
