import { useEffect } from 'react'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import {
  buildMeasurementLineFeatureCollection,
  buildMeasurementPointFeatureCollection,
} from '../../lib/mapMeasurement'
import type { MapPoint } from '../../lib/mapPoint'

export interface MapMeasurementLayersInput {
  mapRef: React.RefObject<MapLibreMap | null>
  mapLoaded: boolean
  points: MapPoint[]
}

export function useMapMeasurementLayers({
  mapRef,
  mapLoaded,
  points,
}: MapMeasurementLayersInput): void {
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const pointData = buildMeasurementPointFeatureCollection(points)
    const lineData = buildMeasurementLineFeatureCollection(points)

    const pointSource = map.getSource('measurement-points') as GeoJSONSource | undefined
    const lineSource = map.getSource('measurement-line') as GeoJSONSource | undefined

    if (pointSource && lineSource) {
      pointSource.setData(pointData)
      lineSource.setData(lineData)
      return
    }

    if (!lineSource) {
      map.addSource('measurement-line', { type: 'geojson', data: lineData })
    }
    if (!pointSource) {
      map.addSource('measurement-points', { type: 'geojson', data: pointData })
    }

    map.addLayer({
      id: 'measurement-line',
      type: 'line',
      source: 'measurement-line',
      paint: {
        'line-color': '#8fd6ff',
        'line-width': 2.5,
        'line-dasharray': [2, 1.5],
        'line-opacity': 0.95,
      },
    })

    map.addLayer({
      id: 'measurement-points',
      type: 'circle',
      source: 'measurement-points',
      paint: {
        'circle-radius': 6,
        'circle-color': [
          'match',
          ['get', 'role'],
          'anchor',
          '#8fd6ff',
          '#ffd166',
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#111827',
        'circle-opacity': 0.95,
      },
    })

    map.addLayer({
      id: 'measurement-point-labels',
      type: 'symbol',
      source: 'measurement-points',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Semibold'],
        'text-size': 11,
        'text-offset': [0, -1.2],
      },
      paint: {
        'text-color': '#f8fafc',
        'text-halo-color': '#111827',
        'text-halo-width': 1,
      },
    })
  }, [mapLoaded, mapRef, points])
}
