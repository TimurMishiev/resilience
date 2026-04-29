/**
 * useMapOverlays
 *
 * Manages MapLibre GeoJSON sources and layers for area-of-operation polygons,
 * geofence rings, geofence breach rings (with pulse animation), sensor
 * coverage circles, and chokepoint watch circles.
 *
 * Extracted from useMapLibreEngine to keep the main hook focused on map
 * lifecycle, site/asset entities, signals, and click handling.
 */

import { useEffect, useRef } from 'react'
import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
} from 'maplibre-gl'
import type { Site, AreaOfOperation, Chokepoint } from '../../api/types'
import type { CoverageCircle } from '../../lib/coverage'
import { circlePolygon } from '../../lib/coverage'

export interface MapOverlaysInput {
  mapRef:    React.RefObject<MapLibreMap | null>
  mapLoaded: boolean

  sites:            Site[]
  areaOfOperations: AreaOfOperation[]
  breachedSiteIds:  Set<string>
  coverageCircles:  CoverageCircle[]
  chokepoints:      Chokepoint[]

  showCoverage:    boolean
  showChokepoints: boolean
}

export function useMapOverlays({
  mapRef,
  mapLoaded,
  sites,
  areaOfOperations,
  breachedSiteIds,
  coverageCircles,
  chokepoints,
  showCoverage,
  showChokepoints,
}: MapOverlaysInput): void {
  const breachPulseRef = useRef<number | null>(null)

  // ---------------------------------------------------------------------------
  // AO polygon overlays
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const geojsonData: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: areaOfOperations.map(ao => ({
        type:       'Feature' as const,
        properties: { color: ao.color, name: ao.name },
        geometry:   ao.geometry,
      })),
    }

    const source = map.getSource('ao-polygons') as GeoJSONSource | undefined
    if (source) { source.setData(geojsonData); return }

    map.addSource('ao-polygons', { type: 'geojson', data: geojsonData })
    const beforeLayer = map.getLayer('site-circles') ? 'site-circles' : undefined
    map.addLayer(
      { id: 'ao-fill', type: 'fill', source: 'ao-polygons', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 } },
      beforeLayer,
    )
    map.addLayer({
      id: 'ao-stroke', type: 'line', source: 'ao-polygons',
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-dasharray': [4, 2] },
    })
  }, [mapLoaded, areaOfOperations, mapRef])

  // ---------------------------------------------------------------------------
  // Geofence rings — dashed blue circle per site
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const geojsonData: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: sites
        .filter(s => s.geofence_radius_km > 0)
        .map(s => circlePolygon(Number(s.latitude), Number(s.longitude), s.geofence_radius_km)),
    }

    const existing = map.getSource('geofence-rings') as GeoJSONSource | undefined
    if (existing) { existing.setData(geojsonData); return }

    map.addSource('geofence-rings', { type: 'geojson', data: geojsonData })
    map.addLayer(
      { id: 'geofence-fill', type: 'fill', source: 'geofence-rings', paint: { 'fill-color': '#5c7cfa', 'fill-opacity': 0.04 } },
      map.getLayer('ao-fill') ? 'ao-fill' : undefined,
    )
    map.addLayer({
      id: 'geofence-stroke', type: 'line', source: 'geofence-rings',
      paint: { 'line-color': '#5c7cfa', 'line-width': 1, 'line-dasharray': [3, 3], 'line-opacity': 0.6 },
    })
  }, [mapLoaded, sites, mapRef])

  // ---------------------------------------------------------------------------
  // Geofence breach rings — solid red ring for sites with active breaches
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const geojsonData: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: sites
        .filter(s => s.geofence_radius_km > 0 && breachedSiteIds.has(s.id))
        .map(s => circlePolygon(Number(s.latitude), Number(s.longitude), s.geofence_radius_km)),
    }

    const existing = map.getSource('geofence-breach-rings') as GeoJSONSource | undefined
    if (existing) { existing.setData(geojsonData); return }

    map.addSource('geofence-breach-rings', { type: 'geojson', data: geojsonData })
    map.addLayer({
      id: 'geofence-breach-fill', type: 'fill', source: 'geofence-breach-rings',
      paint: { 'fill-color': '#fa5252', 'fill-opacity': 0.06 },
    })
    map.addLayer({
      id: 'geofence-breach-stroke', type: 'line', source: 'geofence-breach-rings',
      paint: { 'line-color': '#fa5252', 'line-width': 2, 'line-opacity': 0.7 },
    })
  }, [mapLoaded, sites, breachedSiteIds, mapRef])

  // ---------------------------------------------------------------------------
  // Breach ring pulse — sine-wave opacity on the red stroke layer
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!mapLoaded || breachedSiteIds.size === 0) {
      if (breachPulseRef.current !== null) {
        window.cancelAnimationFrame(breachPulseRef.current)
        breachPulseRef.current = null
      }
      // QA F1 (2026-04-28): MapLibre's setPaintProperty raises AND emits
      // its own console.error when the target layer doesn't exist —
      // try/catch suppresses the throw but not the log, leaving repeated
      // "Cannot style non-existing layer" noise in the dev console during
      // /map navigation. Guarding with getLayer() prevents the call from
      // being attempted at all, eliminating the noise. The try/catch
      // stays as defence-in-depth in case getLayer returns truthy but
      // the layer is in a bad state during a style change.
      const m = mapRef.current
      if (m && m.getLayer('geofence-breach-stroke')) {
        try { m.setPaintProperty('geofence-breach-stroke', 'line-opacity', 0.7) } catch { /* layer may not exist yet */ }
      }
      return
    }

    const animate = (timestamp: number) => {
      const map = mapRef.current
      if (!map) return
      // Same guard as above (QA F1) — only attempt setPaintProperty on
      // an animation tick if the layer is actually live. Without this,
      // every requestAnimationFrame fire produces a console.error until
      // the layer is added.
      if (!map.getLayer('geofence-breach-stroke')) {
        breachPulseRef.current = window.requestAnimationFrame(animate)
        return
      }
      try {
        const opacity = 0.5 + 0.35 * Math.sin((timestamp / 630) * Math.PI)
        map.setPaintProperty('geofence-breach-stroke', 'line-opacity', opacity)
      } catch { /* layer not yet initialised */ }
      breachPulseRef.current = window.requestAnimationFrame(animate)
    }

    breachPulseRef.current = window.requestAnimationFrame(animate)

    return () => {
      if (breachPulseRef.current !== null) {
        window.cancelAnimationFrame(breachPulseRef.current)
        breachPulseRef.current = null
      }
    }
  }, [mapLoaded, breachedSiteIds.size, mapRef])

  // ---------------------------------------------------------------------------
  // Sensor coverage circles
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const geojsonData: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: coverageCircles.map(circle => ({
        ...circlePolygon(circle.anchorLat, circle.anchorLng, circle.radiusKm),
        properties: {
          asset_id:      circle.assetId,
          asset_name:    circle.assetName,
          asset_type:    circle.assetType,
          status:        circle.status,
          anchor_source: circle.anchorSource,
          anchor_label:  circle.anchorLabel,
          radius_km:     circle.radiusKm,
        },
      })),
    }

    const existing = map.getSource('sensor-coverage') as GeoJSONSource | undefined
    if (existing) { existing.setData(geojsonData); return }

    map.addSource('sensor-coverage', { type: 'geojson', data: geojsonData })

    map.addLayer({
      id: 'sensor-coverage-fill', type: 'fill', source: 'sensor-coverage',
      paint: {
        'fill-color': ['match', ['get', 'status'], 'available', '#3ddc84', 'assigned', '#5282ff', 'degraded', '#ffb366', '#8f99a8'],
        'fill-opacity': 0.08,
      },
    }, map.getLayer('geofence-fill') ? 'geofence-fill' : undefined)

    map.addLayer({
      id: 'sensor-coverage-stroke', type: 'line', source: 'sensor-coverage',
      paint: {
        'line-color':     ['match', ['get', 'status'], 'available', '#3ddc84', 'assigned', '#5282ff', 'degraded', '#ffb366', '#8f99a8'],
        'line-width':     ['match', ['get', 'status'], 'degraded', 1.25, 1.5],
        'line-dasharray': ['match', ['get', 'status'], 'degraded', ['literal', [2, 2]], ['literal', [1, 0]]],
        'line-opacity':   0.45,
      },
    })
  }, [coverageCircles, mapLoaded, mapRef])

  // ---------------------------------------------------------------------------
  // Chokepoint watch circles — status-colored fill + dashed stroke
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const statusColor: ExpressionSpecification = [
      'match', ['get', 'status'],
      'monitor',     '#ffd43b',
      'constrained', '#ff922b',
      'contested',   '#fa5252',
      /* closed → */ '#868e96',
    ]

    const geojsonData: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: chokepoints.map(cp => ({
        ...circlePolygon(cp.latitude, cp.longitude, cp.watch_radius_km),
        properties: { id: cp.id, name: cp.name, status: cp.status },
      })),
    }

    const existing = map.getSource('chokepoint-circles') as GeoJSONSource | undefined
    if (existing) { existing.setData(geojsonData); return }

    map.addSource('chokepoint-circles', { type: 'geojson', data: geojsonData })

    map.addLayer({
      id: 'chokepoint-fill', type: 'fill', source: 'chokepoint-circles',
      paint: { 'fill-color': statusColor, 'fill-opacity': 0.10 },
    }, map.getLayer('sensor-coverage-fill') ? 'sensor-coverage-fill' : undefined)

    map.addLayer({
      id: 'chokepoint-stroke', type: 'line', source: 'chokepoint-circles',
      paint: { 'line-color': statusColor, 'line-width': 1.5, 'line-dasharray': [4, 2], 'line-opacity': 0.65 },
    })
  }, [chokepoints, mapLoaded, mapRef])

  // ---------------------------------------------------------------------------
  // Chokepoint layer visibility
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !map.getLayer('chokepoint-fill')) return
    const vis = showChokepoints ? 'visible' : 'none'
    map.setLayoutProperty('chokepoint-fill', 'visibility', vis)
    if (map.getLayer('chokepoint-stroke')) {
      map.setLayoutProperty('chokepoint-stroke', 'visibility', vis)
    }
  }, [showChokepoints, mapLoaded, mapRef])

  // ---------------------------------------------------------------------------
  // Coverage layer visibility
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !map.getLayer('sensor-coverage-fill')) return
    const vis = showCoverage ? 'visible' : 'none'
    map.setLayoutProperty('sensor-coverage-fill',   'visibility', vis)
    if (map.getLayer('sensor-coverage-stroke')) {
      map.setLayoutProperty('sensor-coverage-stroke', 'visibility', vis)
    }
  }, [showCoverage, mapLoaded, mapRef])
}
