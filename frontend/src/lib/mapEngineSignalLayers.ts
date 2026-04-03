import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapGeoJSONFeature,
  MapMouseEvent,
} from 'maplibre-gl'
import { buildClusteredSignalSourceDefinition } from './mapSignalClustering'
import { buildSignalPopupContent } from './mapRenderData'
import { signalCircleRadiusExpression, signalColorExpression, signalGlowRadiusExpression, signalSymbolExpression, selectedSignalRingRadiusExpression } from './mapEngineStyles'

type PopupConstructor = typeof import('maplibre-gl').Popup

export function updateSignalSources(
  map: MapLibreMap,
  clusterable: GeoJSON.FeatureCollection,
  selected: GeoJSON.FeatureCollection,
  heatmap: GeoJSON.FeatureCollection,
) {
  const clusterSource = map.getSource('signal-points') as GeoJSONSource | undefined
  const selectedSource = map.getSource('selected-signal-point') as GeoJSONSource | undefined
  const heatmapSource = map.getSource('signal-heatmap-points') as GeoJSONSource | undefined
  if (clusterSource) clusterSource.setData(clusterable)
  if (selectedSource) selectedSource.setData(selected)
  if (heatmapSource) heatmapSource.setData(heatmap)
}

export function ensureSignalLayers(
  map: MapLibreMap,
  PopupCtor: PopupConstructor | undefined,
  clusterable: GeoJSON.FeatureCollection,
  selected: GeoJSON.FeatureCollection,
  heatmap: GeoJSON.FeatureCollection,
) {
  if (!map.getSource('signal-points')) {
    map.addSource('signal-points', buildClusteredSignalSourceDefinition(clusterable))
  }

  if (!map.getSource('selected-signal-point')) {
    map.addSource('selected-signal-point', {
      type: 'geojson',
      data: selected,
    })
  }

  if (!map.getSource('signal-heatmap-points')) {
    map.addSource('signal-heatmap-points', {
      type: 'geojson',
      data: heatmap,
    })
  }

  if (!map.getLayer('signal-clusters')) {
    map.addLayer({
      id: 'signal-clusters',
      type: 'circle',
      source: 'signal-points',
      filter: ['has', 'point_count'],
      paint: {
        'circle-radius': ['step', ['get', 'point_count'], 17, 10, 21, 25, 26],
        'circle-color': ['step', ['get', 'point_count'], '#143649', 10, '#1d4f68', 25, '#285f7a'],
        'circle-opacity': 0.94,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#c6e6f5',
        'circle-stroke-opacity': 0.9,
      },
    })
  }

  if (!map.getLayer('signal-cluster-count')) {
    map.addLayer({
      id: 'signal-cluster-count',
      type: 'symbol',
      source: 'signal-points',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-size': 11,
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#f5fbff',
        'text-halo-color': 'rgba(0,0,0,0.35)',
        'text-halo-width': 1,
      },
    })
  }

  if (!map.getLayer('signal-heatmap')) {
    map.addLayer({
      id: 'signal-heatmap',
      type: 'heatmap',
      source: 'signal-heatmap-points',
      maxzoom: 13,
      layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': [
          'match', ['get', 'signal_type'],
          'seismic_event', 1.3,
          'wildfire', 1.25,
          'conflict_event', 1.15,
          'disaster_alert', 1.15,
          'gps_jamming', 1.1,
          1,
        ],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.7, 6, 1.1, 10, 1.6, 13, 2.1],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(16, 24, 40, 0)',
          0.15, 'rgba(32, 163, 158, 0.25)',
          0.35, 'rgba(74, 222, 128, 0.45)',
          0.55, 'rgba(250, 204, 21, 0.62)',
          0.75, 'rgba(249, 115, 22, 0.78)',
          1, 'rgba(239, 68, 68, 0.94)',
        ],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 12, 5, 18, 9, 28, 13, 40],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.72, 8, 0.68, 13, 0.28],
      },
    }, 'signal-clusters')
  }

  if (!map.getLayer('signal-glow')) {
    map.addLayer({
      id: 'signal-glow',
      type: 'circle',
      source: 'signal-points',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': signalGlowRadiusExpression(),
        'circle-color': signalColorExpression(),
        'circle-opacity': 0.15,
        'circle-blur': 1.2,
      },
    })
  }

  if (!map.getLayer('signal-circles')) {
    map.addLayer({
      id: 'signal-circles',
      type: 'circle',
      source: 'signal-points',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': signalCircleRadiusExpression(),
        'circle-color': signalColorExpression(),
        'circle-opacity': 0.85,
        'circle-stroke-width': 1,
        'circle-stroke-color': 'rgba(255,255,255,0.25)',
      },
    })
  }

  if (!map.getLayer('signal-symbols')) {
    map.addLayer({
      id: 'signal-symbols',
      type: 'symbol',
      source: 'signal-points',
      filter: ['!', ['has', 'point_count']],
      layout: {
        'text-field': signalSymbolExpression(),
        'text-size': 11,
        'text-anchor': 'center',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.45)',
        'text-halo-width': 1,
      },
    })
  }

  if (!map.getLayer('selected-signal-ring')) {
    map.addLayer({
      id: 'selected-signal-ring',
      type: 'circle',
      source: 'selected-signal-point',
      paint: {
        'circle-radius': selectedSignalRingRadiusExpression(),
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.95,
        'circle-blur': 0.2,
      },
    })
  }

  if (!map.getLayer('selected-signal-glow')) {
    map.addLayer({
      id: 'selected-signal-glow',
      type: 'circle',
      source: 'selected-signal-point',
      paint: {
        'circle-radius': signalGlowRadiusExpression(),
        'circle-color': signalColorExpression(),
        'circle-opacity': 0.26,
        'circle-blur': 1.35,
      },
    })
  }

  if (!map.getLayer('selected-signal-circle')) {
    map.addLayer({
      id: 'selected-signal-circle',
      type: 'circle',
      source: 'selected-signal-point',
      paint: {
        'circle-radius': signalCircleRadiusExpression(),
        'circle-color': signalColorExpression(),
        'circle-opacity': 0.96,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
      },
    })
  }

  if (!map.getLayer('selected-signal-symbol')) {
    map.addLayer({
      id: 'selected-signal-symbol',
      type: 'symbol',
      source: 'selected-signal-point',
      layout: {
        'text-field': signalSymbolExpression(),
        'text-size': 11,
        'text-anchor': 'center',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.45)',
        'text-halo-width': 1,
      },
    })
  }

  const handleClusterMouseEnter = () => { map.getCanvas().style.cursor = 'pointer' }
  const handleClusterMouseLeave = () => { map.getCanvas().style.cursor = '' }

  map.on('mouseenter', 'signal-clusters', handleClusterMouseEnter)
  map.on('mouseleave', 'signal-clusters', handleClusterMouseLeave)

  if (!PopupCtor) {
    return () => {
      map.off('mouseenter', 'signal-clusters', handleClusterMouseEnter)
      map.off('mouseleave', 'signal-clusters', handleClusterMouseLeave)
    }
  }

  const popup = new PopupCtor({
    closeButton: false,
    closeOnClick: false,
    offset: 8,
    className: 'signal-popup-container',
  })

  const handleMouseEnter = (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
    map.getCanvas().style.cursor = 'pointer'
    if (!event.features?.length) return
    const feature = event.features[0]
    if (!feature.geometry || feature.geometry.type !== 'Point') return

    const [lng, lat] = feature.geometry.coordinates
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return

    const props = (feature.properties ?? {}) as Record<string, string>
    popup.setLngLat([lng, lat]).setDOMContent(buildSignalPopupContent(props)).addTo(map)
  }
  const handleMouseLeave = () => { map.getCanvas().style.cursor = ''; popup.remove() }

  map.on('mouseenter', 'signal-circles', handleMouseEnter)
  map.on('mouseenter', 'signal-symbols', handleMouseEnter)
  map.on('mouseenter', 'selected-signal-circle', handleMouseEnter)
  map.on('mouseenter', 'selected-signal-symbol', handleMouseEnter)
  map.on('mouseleave', 'signal-circles', handleMouseLeave)
  map.on('mouseleave', 'signal-symbols', handleMouseLeave)
  map.on('mouseleave', 'selected-signal-circle', handleMouseLeave)
  map.on('mouseleave', 'selected-signal-symbol', handleMouseLeave)

  return () => {
    popup.remove()
    map.off('mouseenter', 'signal-clusters', handleClusterMouseEnter)
    map.off('mouseleave', 'signal-clusters', handleClusterMouseLeave)
    map.off('mouseenter', 'signal-circles', handleMouseEnter)
    map.off('mouseenter', 'signal-symbols', handleMouseEnter)
    map.off('mouseenter', 'selected-signal-circle', handleMouseEnter)
    map.off('mouseenter', 'selected-signal-symbol', handleMouseEnter)
    map.off('mouseleave', 'signal-circles', handleMouseLeave)
    map.off('mouseleave', 'signal-symbols', handleMouseLeave)
    map.off('mouseleave', 'selected-signal-circle', handleMouseLeave)
    map.off('mouseleave', 'selected-signal-symbol', handleMouseLeave)
  }
}
