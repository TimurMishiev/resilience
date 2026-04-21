import { useEffect } from 'react'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import {
  buildRangeRingAnchorFeatureCollection,
  buildRangeRingLabelFeatureCollection,
  buildRangeRingLineFeatureCollection,
  type RangeRingUnit,
} from '../../lib/mapRangeRings'
import type { MapPoint } from '../../lib/mapPoint'

export interface MapRangeRingLayersInput {
  mapRef: React.RefObject<MapLibreMap | null>
  mapLoaded: boolean
  anchor: MapPoint | null
  radiiKm: number[]
  unit: RangeRingUnit
}

export function useMapRangeRingLayers({
  mapRef,
  mapLoaded,
  anchor,
  radiiKm,
  unit,
}: MapRangeRingLayersInput): void {
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const anchorData = buildRangeRingAnchorFeatureCollection(anchor)
    const lineData = buildRangeRingLineFeatureCollection(anchor, radiiKm)
    const labelData = buildRangeRingLabelFeatureCollection(anchor, radiiKm, unit)

    const anchorSource = map.getSource('map-range-ring-anchor') as GeoJSONSource | undefined
    const lineSource = map.getSource('map-range-rings') as GeoJSONSource | undefined
    const labelSource = map.getSource('map-range-ring-labels') as GeoJSONSource | undefined

    if (anchorSource && lineSource && labelSource) {
      anchorSource.setData(anchorData)
      lineSource.setData(lineData)
      labelSource.setData(labelData)
      return
    }

    if (!anchorSource) {
      map.addSource('map-range-ring-anchor', { type: 'geojson', data: anchorData })
    }
    if (!lineSource) {
      map.addSource('map-range-rings', { type: 'geojson', data: lineData })
    }
    if (!labelSource) {
      map.addSource('map-range-ring-labels', { type: 'geojson', data: labelData })
    }

    map.addLayer({
      id: 'map-range-rings',
      type: 'line',
      source: 'map-range-rings',
      paint: {
        'line-color': '#b8f574',
        'line-width': 2,
        'line-dasharray': [1.5, 1.25],
        'line-opacity': 0.92,
      },
    })

    map.addLayer({
      id: 'map-range-ring-anchor',
      type: 'circle',
      source: 'map-range-ring-anchor',
      paint: {
        'circle-radius': 5,
        'circle-color': '#b8f574',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#111827',
        'circle-opacity': 0.95,
      },
    })

    map.addLayer({
      id: 'map-range-ring-labels',
      type: 'symbol',
      source: 'map-range-ring-labels',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Semibold'],
        'text-size': 11,
        'text-offset': [0.8, 0],
        'text-anchor': 'left',
      },
      paint: {
        'text-color': '#f2ffe1',
        'text-halo-color': '#111827',
        'text-halo-width': 1,
      },
    })
  }, [anchor, mapLoaded, mapRef, radiiKm, unit])
}
