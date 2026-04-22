import { useEffect } from 'react'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import {
  buildSectorAnchorFeatureCollection,
  buildSectorFillFeatureCollection,
  buildSectorLabelFeatureCollection,
  buildSectorOutlineFeatureCollection,
} from '../../lib/mapSectorOverlay'
import type { MapPoint } from '../../lib/mapPoint'
import type { RangeRingUnit } from '../../lib/mapRangeRings'

export interface MapSectorOverlayLayersInput {
  mapRef: React.RefObject<MapLibreMap | null>
  mapLoaded: boolean
  anchor: MapPoint | null
  bearingDegrees: number | null
  arcDegrees: number | null
  distanceKm: number | null
  unit: RangeRingUnit
}

export function useMapSectorOverlayLayers({
  mapRef,
  mapLoaded,
  anchor,
  bearingDegrees,
  arcDegrees,
  distanceKm,
  unit,
}: MapSectorOverlayLayersInput): void {
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const fillData = buildSectorFillFeatureCollection(anchor, bearingDegrees, arcDegrees, distanceKm)
    const outlineData = buildSectorOutlineFeatureCollection(anchor, bearingDegrees, arcDegrees, distanceKm)
    const anchorData = buildSectorAnchorFeatureCollection(anchor)
    const labelData = buildSectorLabelFeatureCollection(anchor, bearingDegrees, arcDegrees, distanceKm, unit)

    const fillSource = map.getSource('map-sector-fill') as GeoJSONSource | undefined
    const outlineSource = map.getSource('map-sector-outline') as GeoJSONSource | undefined
    const anchorSource = map.getSource('map-sector-anchor') as GeoJSONSource | undefined
    const labelSource = map.getSource('map-sector-labels') as GeoJSONSource | undefined

    if (fillSource && outlineSource && anchorSource && labelSource) {
      fillSource.setData(fillData)
      outlineSource.setData(outlineData)
      anchorSource.setData(anchorData)
      labelSource.setData(labelData)
      return
    }

    if (!fillSource) {
      map.addSource('map-sector-fill', { type: 'geojson', data: fillData })
    }
    if (!outlineSource) {
      map.addSource('map-sector-outline', { type: 'geojson', data: outlineData })
    }
    if (!anchorSource) {
      map.addSource('map-sector-anchor', { type: 'geojson', data: anchorData })
    }
    if (!labelSource) {
      map.addSource('map-sector-labels', { type: 'geojson', data: labelData })
    }

    map.addLayer({
      id: 'map-sector-fill',
      type: 'fill',
      source: 'map-sector-fill',
      paint: {
        'fill-color': '#7dd3fc',
        'fill-opacity': 0.14,
      },
    })

    map.addLayer({
      id: 'map-sector-outline',
      type: 'line',
      source: 'map-sector-outline',
      paint: {
        'line-color': '#7dd3fc',
        'line-width': 2.2,
        'line-opacity': 0.94,
      },
    })

    map.addLayer({
      id: 'map-sector-anchor',
      type: 'circle',
      source: 'map-sector-anchor',
      paint: {
        'circle-radius': 5,
        'circle-color': '#7dd3fc',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#111827',
        'circle-opacity': 0.95,
      },
    })

    map.addLayer({
      id: 'map-sector-labels',
      type: 'symbol',
      source: 'map-sector-labels',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Semibold'],
        'text-size': 11,
        'text-offset': [0.8, 0],
        'text-anchor': 'left',
      },
      paint: {
        'text-color': '#e0f7ff',
        'text-halo-color': '#111827',
        'text-halo-width': 1,
      },
    })
  }, [anchor, arcDegrees, bearingDegrees, distanceKm, mapLoaded, mapRef, unit])
}
