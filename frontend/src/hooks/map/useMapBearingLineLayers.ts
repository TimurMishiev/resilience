import { useEffect } from 'react'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import {
  buildBearingLineFeatureCollection,
  buildBearingLineLabelFeatureCollection,
  buildBearingLinePointFeatureCollection,
} from '../../lib/mapBearingLine'
import type { MapPoint } from '../../lib/mapPoint'
import type { RangeRingUnit } from '../../lib/mapRangeRings'

export interface MapBearingLineLayersInput {
  mapRef: React.RefObject<MapLibreMap | null>
  mapLoaded: boolean
  anchor: MapPoint | null
  bearingDegrees: number | null
  distanceKm: number | null
  unit: RangeRingUnit
}

export function useMapBearingLineLayers({
  mapRef,
  mapLoaded,
  anchor,
  bearingDegrees,
  distanceKm,
  unit,
}: MapBearingLineLayersInput): void {
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const lineData = buildBearingLineFeatureCollection(anchor, bearingDegrees, distanceKm)
    const pointData = buildBearingLinePointFeatureCollection(anchor, bearingDegrees, distanceKm)
    const labelData = buildBearingLineLabelFeatureCollection(anchor, bearingDegrees, distanceKm, unit)

    const lineSource = map.getSource('map-bearing-line') as GeoJSONSource | undefined
    const pointSource = map.getSource('map-bearing-points') as GeoJSONSource | undefined
    const labelSource = map.getSource('map-bearing-labels') as GeoJSONSource | undefined

    if (lineSource && pointSource && labelSource) {
      lineSource.setData(lineData)
      pointSource.setData(pointData)
      labelSource.setData(labelData)
      return
    }

    if (!lineSource) {
      map.addSource('map-bearing-line', { type: 'geojson', data: lineData })
    }
    if (!pointSource) {
      map.addSource('map-bearing-points', { type: 'geojson', data: pointData })
    }
    if (!labelSource) {
      map.addSource('map-bearing-labels', { type: 'geojson', data: labelData })
    }

    map.addLayer({
      id: 'map-bearing-line',
      type: 'line',
      source: 'map-bearing-line',
      paint: {
        'line-color': '#ffb366',
        'line-width': 2.5,
        'line-dasharray': [1.8, 1.2],
        'line-opacity': 0.94,
      },
    })

    map.addLayer({
      id: 'map-bearing-points',
      type: 'circle',
      source: 'map-bearing-points',
      paint: {
        'circle-radius': ['match', ['get', 'kind'], 'anchor', 5, 'endpoint', 4, 4],
        'circle-color': ['match', ['get', 'kind'], 'anchor', '#ffb366', 'endpoint', '#ffd8a8', '#ffb366'],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#111827',
        'circle-opacity': 0.95,
      },
    })

    map.addLayer({
      id: 'map-bearing-labels',
      type: 'symbol',
      source: 'map-bearing-labels',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Semibold'],
        'text-size': 11,
        'text-offset': [0.8, -0.2],
        'text-anchor': 'left',
      },
      paint: {
        'text-color': '#fff3dd',
        'text-halo-color': '#111827',
        'text-halo-width': 1,
      },
    })
  }, [anchor, bearingDegrees, distanceKm, mapLoaded, mapRef, unit])
}
