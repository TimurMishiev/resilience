/**
 * useMapAssetLayers
 *
 * Manages MapLibre GeoJSON source + layers for asset points, symbols, and
 * selection ring. Extracted from useMapLibreEngine.
 */

import { useEffect } from 'react'
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl'
import type { Site, Asset } from '../../api/types'
import { buildAssetFeatureCollection } from '../../lib/mapRenderData'
import type { TelemetryMap } from '../../lib/telemetry'

const EMPTY_READINGS: TelemetryMap = new Map()

export interface MapAssetLayersInput {
  mapRef:    React.RefObject<MapLibreMap | null>
  mapLoaded: boolean
  sites:     Site[]
  assets:    Asset[]
  readings:  TelemetryMap
  isReplaying: boolean
  referenceTimeMs: number
  selectedAssetId: string | null
  linkedSiteId: string | null
}

export function useMapAssetLayers({
  mapRef,
  mapLoaded,
  sites,
  assets,
  readings,
  isReplaying,
  referenceTimeMs,
  selectedAssetId,
  linkedSiteId,
}: MapAssetLayersInput): void {
  // Source + layer init
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    if (!map.getSource('asset-points')) {
      map.addSource('asset-points', { type: 'geojson', data: buildAssetFeatureCollection([], [], EMPTY_READINGS, false, 0) })
    }

    if (!map.getLayer('asset-circles')) {
      map.addLayer({
        id: 'asset-circles',
        type: 'circle',
        source: 'asset-points',
        paint: {
          'circle-radius': 11,
          'circle-color': [
            'match', ['get', 'status'],
            'available', '#163329',
            'assigned', '#1f2f4a',
            'degraded', '#4a2f17',
            '#3a3f4b',
          ],
          'circle-opacity': [
            'match', ['get', 'freshness'],
            'fresh', 0.94,
            'aging', 0.72,
            'stale', 0.46,
            'unavailable', 0.32,
            0.94,
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': [
            'match', ['get', 'status'],
            'available', '#3ddc84',
            'assigned', '#5282ff',
            'degraded', '#ffb366',
            '#8f99a8',
          ],
          'circle-stroke-opacity': [
            'match', ['get', 'freshness'],
            'fresh', 1,
            'aging', 0.8,
            'stale', 0.58,
            'unavailable', 0.42,
            1,
          ],
        },
      })
    }

    if (!map.getLayer('asset-selection-ring')) {
      map.addLayer({
        id: 'asset-selection-ring',
        type: 'circle',
        source: 'asset-points',
        paint: {
          'circle-radius': 17,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#9ed0ff',
          'circle-stroke-opacity': 0.95,
        },
        filter: ['==', ['get', 'id'], ''],
      })
    }

    if (!map.getLayer('asset-linked-ring')) {
      map.addLayer({
        id: 'asset-linked-ring',
        type: 'circle',
        source: 'asset-points',
        paint: {
          'circle-radius': 15,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': 0.55,
          'circle-blur': 0.3,
        },
        filter: ['==', ['get', 'home_site_id'], ''],
      })
    }

    if (!map.getLayer('asset-symbols')) {
      map.addLayer({
        id: 'asset-symbols',
        type: 'symbol',
        source: 'asset-points',
        layout: {
          'text-field': ['get', 'icon'],
          'text-size': 13,
          'text-anchor': 'center',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.55)',
          'text-halo-width': 1,
          'text-opacity': [
            'match', ['get', 'freshness'],
            'fresh', 1,
            'aging', 0.78,
            'stale', 0.54,
            'unavailable', 0.4,
            1,
          ],
        },
      })
    }

    const handleMouseEnter = () => { map.getCanvas().style.cursor = 'pointer' }
    const handleMouseLeave = () => { map.getCanvas().style.cursor = '' }

    map.on('mouseenter', 'asset-circles', handleMouseEnter)
    map.on('mouseenter', 'asset-symbols', handleMouseEnter)
    map.on('mouseleave', 'asset-circles', handleMouseLeave)
    map.on('mouseleave', 'asset-symbols', handleMouseLeave)

    return () => {
      map.off('mouseenter', 'asset-circles', handleMouseEnter)
      map.off('mouseenter', 'asset-symbols', handleMouseEnter)
      map.off('mouseleave', 'asset-circles', handleMouseLeave)
      map.off('mouseleave', 'asset-symbols', handleMouseLeave)
    }
  }, [mapLoaded, mapRef])

  // Data update
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const existing = map.getSource('asset-points') as GeoJSONSource | undefined
    if (existing) existing.setData(buildAssetFeatureCollection(assets, sites, readings, isReplaying, referenceTimeMs))
  }, [assets, isReplaying, mapLoaded, readings, referenceTimeMs, sites, mapRef])

  // Selection ring filter
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !map.getLayer('asset-selection-ring')) return
    map.setFilter(
      'asset-selection-ring',
      ['==', ['get', 'id'], selectedAssetId ?? ''],
    )
  }, [mapLoaded, selectedAssetId, mapRef])

  // Linked highlight ring filter (assets at the selected site)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !map.getLayer('asset-linked-ring')) return
    map.setFilter(
      'asset-linked-ring',
      ['==', ['get', 'home_site_id'], linkedSiteId ?? ''],
    )
  }, [mapLoaded, linkedSiteId, mapRef])
}
