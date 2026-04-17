/**
 * useMapSiteLayers
 *
 * Manages MapLibre GeoJSON source + layers for site points and selection ring.
 * Extracted from useMapLibreEngine.
 */

import { useEffect } from 'react'
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl'
import type { Site, Task } from '../../api/types'
import { buildSiteFeatureCollection } from '../../lib/mapRenderData'

export interface MapSiteLayersInput {
  mapRef:    React.RefObject<MapLibreMap | null>
  mapLoaded: boolean
  sites:     Site[]
  tasksBySite: Record<string, Task[]>
  selectedSiteId: string | null
  linkedSiteId: string | null
}

export function useMapSiteLayers({
  mapRef,
  mapLoaded,
  sites,
  tasksBySite,
  selectedSiteId,
  linkedSiteId,
}: MapSiteLayersInput): void {
  // Source + layer init
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    if (!map.getSource('site-points')) {
      map.addSource('site-points', { type: 'geojson', data: buildSiteFeatureCollection([], {}) })
    }

    if (!map.getLayer('site-circles')) {
      map.addLayer({
        id: 'site-circles',
        type: 'circle',
        source: 'site-points',
        paint: {
          'circle-radius': 9,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(255,255,255,0.85)',
        },
      })
    }

    if (!map.getLayer('site-selection-ring')) {
      map.addLayer({
        id: 'site-selection-ring',
        type: 'circle',
        source: 'site-points',
        paint: {
          'circle-radius': 15,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': 0.95,
          'circle-blur': 0.15,
        },
        filter: ['==', ['get', 'id'], ''],
      })
    }

    if (!map.getLayer('site-linked-ring')) {
      map.addLayer({
        id: 'site-linked-ring',
        type: 'circle',
        source: 'site-points',
        paint: {
          'circle-radius': 14,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#5282ff',
          'circle-stroke-opacity': 0.7,
          'circle-blur': 0.3,
        },
        filter: ['==', ['get', 'id'], ''],
      })
    }

    const handleMouseEnter = () => { map.getCanvas().style.cursor = 'pointer' }
    const handleMouseLeave = () => { map.getCanvas().style.cursor = '' }

    map.on('mouseenter', 'site-circles', handleMouseEnter)
    map.on('mouseleave', 'site-circles', handleMouseLeave)

    return () => {
      map.off('mouseenter', 'site-circles', handleMouseEnter)
      map.off('mouseleave', 'site-circles', handleMouseLeave)
    }
  }, [mapLoaded, mapRef])

  // Data update
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const existing = map.getSource('site-points') as GeoJSONSource | undefined
    if (existing) existing.setData(buildSiteFeatureCollection(sites, tasksBySite))
  }, [mapLoaded, sites, tasksBySite, mapRef])

  // Selection ring filter
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !map.getLayer('site-selection-ring')) return
    map.setFilter(
      'site-selection-ring',
      ['==', ['get', 'id'], selectedSiteId ?? ''],
    )
  }, [mapLoaded, selectedSiteId, mapRef])

  // Linked highlight ring filter (e.g. asset's home site when asset is selected)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !map.getLayer('site-linked-ring')) return
    map.setFilter(
      'site-linked-ring',
      ['==', ['get', 'id'], linkedSiteId ?? ''],
    )
  }, [mapLoaded, linkedSiteId, mapRef])
}
