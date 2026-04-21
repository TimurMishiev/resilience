import { useEffect } from 'react'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { buildMapAnnotationFeatureCollection, type MapAnnotation } from '../../lib/mapAnnotations'

export interface MapAnnotationLayersInput {
  mapRef: React.RefObject<MapLibreMap | null>
  mapLoaded: boolean
  annotations: MapAnnotation[]
}

export function useMapAnnotationLayers({
  mapRef,
  mapLoaded,
  annotations,
}: MapAnnotationLayersInput): void {
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const annotationData = buildMapAnnotationFeatureCollection(annotations)
    const annotationSource = map.getSource('map-annotations') as GeoJSONSource | undefined

    if (annotationSource) {
      annotationSource.setData(annotationData)
      return
    }

    map.addSource('map-annotations', { type: 'geojson', data: annotationData })

    map.addLayer({
      id: 'map-annotation-points',
      type: 'circle',
      source: 'map-annotations',
      paint: {
        'circle-radius': 6,
        'circle-color': '#f97316',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#111827',
        'circle-opacity': 0.95,
      },
    })

    map.addLayer({
      id: 'map-annotation-labels',
      type: 'symbol',
      source: 'map-annotations',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Semibold'],
        'text-size': 11,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
      },
      paint: {
        'text-color': '#fff4e6',
        'text-halo-color': '#111827',
        'text-halo-width': 1,
      },
    })
  }, [annotations, mapLoaded, mapRef])
}
