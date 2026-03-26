/**
 * useMapLibreEngine
 *
 * Owns all MapLibre GL lifecycle: map init, style switching, GeoJSON
 * sources/layers, popup handlers, and overlay animations.
 *
 * Design contract:
 *  - Imperative: all effects are internal; the caller passes data + callbacks.
 *  - Callback-driven: map-click events surface through onSiteClick /
 *    onAssetClick / onSignalClick; the page owns all selection state.
 *  - Ref-wrapped callbacks: each callback is mirrored into a ref so the one-
 *    time handler registrations (signal layer, style.load) never go stale
 *    without needing to be re-registered.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  MapGeoJSONFeature,
  MapMouseEvent,
  StyleSpecification,
} from 'maplibre-gl'
import type { Site, Task, Asset, Signal, AreaOfOperation } from '../api/types'
import type { VesselTrack } from '../api/vessels'
import type { CoverageCircle } from '../lib/coverage'
import { circlePolygon } from '../lib/coverage'
import { buildClusteredSignalSourceDefinition, expandMapSignalCluster } from '../lib/mapSignalClustering'
import {
  MAP_INTERACTIVE_LAYER_IDS,
  resolveMapClickCandidate,
  type MapInteractiveKind,
} from '../lib/mapClickResolution'
import {
  buildAssetFeatureCollection,
  buildSignalPopupContent,
  buildSiteFeatureCollection,
} from '../lib/mapRenderData'
import { buildMapSignalRenderCollections } from '../lib/mapSignalRendering'
import { preloadMapRuntime } from '../lib/preloadRoutes'
import { SIGNAL_COLORS } from '../lib/signalConfig'
import type { TelemetryMap } from '../lib/telemetry'

const EMPTY_READINGS: TelemetryMap = new Map()
type MapLibreModule = typeof import('maplibre-gl')

// ---------------------------------------------------------------------------
// Map style config — exported so the MapPage UI can render the switcher
// ---------------------------------------------------------------------------

export type MapStyleKey = 'tactical' | 'satellite' | 'street'

const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'esri-imagery': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '© Esri, Maxar, Earthstar Geographics',
      maxzoom: 18,
    },
    'esri-labels': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 18,
    },
  },
  layers: [
    { id: 'imagery', type: 'raster', source: 'esri-imagery' },
    { id: 'labels',  type: 'raster', source: 'esri-labels',  paint: { 'raster-opacity': 0.85 } },
  ],
}

export const MAP_STYLE_CONFIGS: Record<MapStyleKey, { label: string; style: string | StyleSpecification }> = {
  tactical:  { label: 'Tactical',  style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' },
  satellite: { label: 'Satellite', style: SATELLITE_STYLE },
  street:    { label: 'Street',    style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json' },
}

function signalColorExpression(): ExpressionSpecification {
  return [
    'match', ['get', 'signal_type'],
    'aircraft_position', SIGNAL_COLORS.aircraft_position,
    'vessel_position',   SIGNAL_COLORS.vessel_position,
    'seismic_event',     SIGNAL_COLORS.seismic_event,
    'gps_jamming',       SIGNAL_COLORS.gps_jamming,
    'wildfire',          SIGNAL_COLORS.wildfire,
    'ais_gap',           SIGNAL_COLORS.ais_gap,
    'conflict_event',    SIGNAL_COLORS.conflict_event,
    'disaster_alert',    SIGNAL_COLORS.disaster_alert,
    SIGNAL_COLORS.manual,
  ]
}

function signalGlowRadiusExpression(): ExpressionSpecification {
  return ['match', ['get', 'signal_type'], 'seismic_event', 18, 'wildfire', 16, 12]
}

function signalCircleRadiusExpression(): ExpressionSpecification {
  return ['match', ['get', 'signal_type'], 'seismic_event', 8, 'wildfire', 7, 5]
}

function selectedSignalRingRadiusExpression(): ExpressionSpecification {
  return ['match', ['get', 'signal_type'], 'seismic_event', 14, 'wildfire', 13, 11]
}

function signalSymbolExpression(): ExpressionSpecification {
  return ['match', ['get', 'signal_type'],
    'aircraft_position', '✈',
    'vessel_position', '⚓',
    'seismic_event', '≈',
    'gps_jamming', '⊗',
    'wildfire', '△',
    'ais_gap', '⊙',
    'manual', '+',
    '●',
  ]
}

// ---------------------------------------------------------------------------
// Hook interface
// ---------------------------------------------------------------------------

export interface MapEngineInput {
  containerRef: RefObject<HTMLDivElement | null>

  // Rendered data
  sites:             Site[]
  assets:            Asset[]
  signals:           Signal[]
  tasksBySite:       Record<string, Task[]>
  areaOfOperations:  AreaOfOperation[]
  breachedSiteIds:   Set<string>
  vesselTracks:      VesselTrack[]
  coverageCircles:   CoverageCircle[]
  readings:          TelemetryMap

  // Visibility toggles
  showSignals:  boolean
  showCoverage: boolean
  mapStyle:     MapStyleKey
  isReplaying:  boolean
  selectedSiteId:   string | null
  selectedAssetId:  string | null
  selectedSignalId: string | null

  // Selection callbacks — hook fires, page owns state
  onSiteClick:   (siteId: string | null) => void
  onAssetClick:  (assetId: string | null) => void
  onSignalClick: (signalId: string | null) => void

}

export interface MapEngineReturn {
  /** True once the map style has loaded; gates all source/layer effects. */
  mapLoaded: boolean
  /** Imperatively fly the camera. Safe to call regardless of mapLoaded. */
  flyTo: (center: [number, number], zoom: number) => void
  /** Current map zoom, used only for diagnostics/E2E assertions. */
  getZoom: () => number | null
  /** Projects a lng/lat into current canvas coordinates. */
  projectPosition: (lng: number, lat: number) => { x: number; y: number } | null
  /** Inspects the current rendered interactive target at a canvas point. */
  inspectCanvasPosition: (x: number, y: number) => { kind: MapInteractiveKind; id: string | null; layerId: string } | null
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMapLibreEngine({
  containerRef,
  sites,
  assets,
  signals,
  tasksBySite,
  areaOfOperations,
  breachedSiteIds,
  vesselTracks,
  coverageCircles,
  readings,
  showSignals,
  showCoverage,
  mapStyle,
  isReplaying,
  selectedSiteId,
  selectedAssetId,
  selectedSignalId,
  onSiteClick,
  onAssetClick,
  onSignalClick,
}: MapEngineInput): MapEngineReturn {
  const mapRef           = useRef<MapLibreMap | null>(null)
  const maplibreRef      = useRef<MapLibreModule | null>(null)
  // Kept in a ref so signal click handler never goes stale without re-registering
  const signalsRef       = useRef<Signal[]>([])
  const selectedSignalIdRef = useRef<string | null>(selectedSignalId)
  const breachPulseRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const mapStyleRef      = useRef<MapStyleKey>(mapStyle)
  const appliedStyleRef  = useRef<MapStyleKey | null>(null)

  const [mapLoaded, setMapLoaded] = useState(false)

  // Mirror callbacks into refs so one-time handler registrations stay current
  const onSiteClickRef   = useRef(onSiteClick)
  const onAssetClickRef  = useRef(onAssetClick)
  const onSignalClickRef = useRef(onSignalClick)
  useEffect(() => { onSiteClickRef.current   = onSiteClick   }, [onSiteClick])
  useEffect(() => { onAssetClickRef.current  = onAssetClick  }, [onAssetClick])
  useEffect(() => { onSignalClickRef.current = onSignalClick }, [onSignalClick])
  useEffect(() => { selectedSignalIdRef.current = selectedSignalId }, [selectedSignalId])
  useEffect(() => { mapStyleRef.current = mapStyle }, [mapStyle])

  // ---------------------------------------------------------------------------
  // Map init
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let cancelled = false

    void preloadMapRuntime().then(maplibre => {
      if (cancelled || !containerRef.current || mapRef.current) return
      maplibreRef.current = maplibre
      const initialStyle = mapStyleRef.current
      const map = new maplibre.Map({
        container: containerRef.current,
        style:     MAP_STYLE_CONFIGS[initialStyle].style as string,
        center:    [0, 20],
        zoom:      1.5,
      })
      map.addControl(new maplibre.NavigationControl(), 'top-left')
      map.on('load', () => setMapLoaded(true))
      appliedStyleRef.current = initialStyle
      mapRef.current = map
    })

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      maplibreRef.current = null
      appliedStyleRef.current = null
      setMapLoaded(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- containerRef is stable; run once
  }, [])

  // ---------------------------------------------------------------------------
  // Style switching — skip the very first render (init already loaded tactical)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (appliedStyleRef.current === mapStyle) return
    // Must synchronously clear mapLoaded before setStyle so dependent effects
    // don't fire against the old style context
    setMapLoaded(false)
    appliedStyleRef.current = mapStyle
    map.setStyle(MAP_STYLE_CONFIGS[mapStyle].style as StyleSpecification)
    map.once('style.load', () => setMapLoaded(true))
  }, [mapStyle])

  // ---------------------------------------------------------------------------
  // Site source + layers — style-owned, callbacks stay current via refs
  // ---------------------------------------------------------------------------
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

    const handleMouseEnter = () => { map.getCanvas().style.cursor = 'pointer' }
    const handleMouseLeave = () => { map.getCanvas().style.cursor = '' }

    map.on('mouseenter', 'site-circles', handleMouseEnter)
    map.on('mouseleave', 'site-circles', handleMouseLeave)

    return () => {
      map.off('mouseenter', 'site-circles', handleMouseEnter)
      map.off('mouseleave', 'site-circles', handleMouseLeave)
    }
  }, [mapLoaded])

  // ---------------------------------------------------------------------------
  // Site source data — update when sites / task data changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const existing = map.getSource('site-points') as GeoJSONSource | undefined
    if (existing) existing.setData(buildSiteFeatureCollection(sites, tasksBySite))
  }, [mapLoaded, sites, tasksBySite])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !map.getLayer('site-selection-ring')) return
    map.setFilter(
      'site-selection-ring',
      ['==', ['get', 'id'], selectedSiteId ?? ''],
    )
  }, [mapLoaded, selectedSiteId])

  // ---------------------------------------------------------------------------
  // Asset source + layers — style-owned, positions update via source.setData
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    if (!map.getSource('asset-points')) {
      map.addSource('asset-points', { type: 'geojson', data: buildAssetFeatureCollection([], [], EMPTY_READINGS) })
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
          'circle-stroke-width': 1.5,
          'circle-stroke-color': [
            'match', ['get', 'status'],
            'available', '#3ddc84',
            'assigned', '#5282ff',
            'degraded', '#ffb366',
            '#8f99a8',
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
  }, [mapLoaded])

  // ---------------------------------------------------------------------------
  // Asset source data — update on telemetry/site/asset changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const existing = map.getSource('asset-points') as GeoJSONSource | undefined
    if (existing) existing.setData(buildAssetFeatureCollection(assets, sites, readings, isReplaying))
  }, [assets, isReplaying, mapLoaded, readings, sites])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !map.getLayer('asset-selection-ring')) return
    map.setFilter(
      'asset-selection-ring',
      ['==', ['get', 'id'], selectedAssetId ?? ''],
    )
  }, [mapLoaded, selectedAssetId])

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
  }, [mapLoaded, areaOfOperations])

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
  }, [mapLoaded, sites])

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
  }, [mapLoaded, sites, breachedSiteIds])

  // ---------------------------------------------------------------------------
  // Breach ring pulse — sine-wave opacity on the red stroke layer
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!mapLoaded || breachedSiteIds.size === 0) {
      if (breachPulseRef.current !== null) {
        clearInterval(breachPulseRef.current)
        breachPulseRef.current = null
        try { mapRef.current?.setPaintProperty('geofence-breach-stroke', 'line-opacity', 0.7) } catch { /* layer may not exist yet */ }
      }
      return
    }

    breachPulseRef.current = setInterval(() => {
      const map = mapRef.current
      if (!map) return
      try {
        const opacity = 0.5 + 0.35 * Math.sin((Date.now() / 630) * Math.PI)
        map.setPaintProperty('geofence-breach-stroke', 'line-opacity', opacity)
      } catch { /* layer not yet initialised */ }
    }, 50)

    return () => {
      if (breachPulseRef.current !== null) {
        clearInterval(breachPulseRef.current)
        breachPulseRef.current = null
      }
    }
  }, [mapLoaded, breachedSiteIds.size])

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
  }, [coverageCircles, mapLoaded])

  // ---------------------------------------------------------------------------
  // Keep signalsRef current so signal click handler reads fresh data
  // ---------------------------------------------------------------------------
  useEffect(() => {
    signalsRef.current = signals
  }, [signals])

  // ---------------------------------------------------------------------------
  // Signal GeoJSON source data — update on each refresh
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const { clusterable, selected } = buildMapSignalRenderCollections(signals, selectedSignalId)
    const clusterSource = map.getSource('signal-points') as GeoJSONSource | undefined
    const selectedSource = map.getSource('selected-signal-point') as GeoJSONSource | undefined
    if (clusterSource) clusterSource.setData(clusterable)
    if (selectedSource) selectedSource.setData(selected)
  }, [mapLoaded, selectedSignalId, signals])

  // ---------------------------------------------------------------------------
  // Signal GeoJSON layers + interactions — set up once per style load
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const signalCollections = buildMapSignalRenderCollections(signalsRef.current, selectedSignalIdRef.current)

    if (!map.getSource('signal-points')) {
      map.addSource('signal-points', buildClusteredSignalSourceDefinition(signalCollections.clusterable))
    }

    if (!map.getSource('selected-signal-point')) {
      map.addSource('selected-signal-point', {
        type: 'geojson',
        data: signalCollections.selected,
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

    if (!map.getLayer('signal-glow')) {
      map.addLayer({
        id: 'signal-glow', type: 'circle', source: 'signal-points',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': signalGlowRadiusExpression(),
          'circle-color': signalColorExpression(),
          'circle-opacity': 0.15,
          'circle-blur':    1.2,
        },
      })
    }

    if (!map.getLayer('signal-circles')) {
      map.addLayer({
        id: 'signal-circles', type: 'circle', source: 'signal-points',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': signalCircleRadiusExpression(),
          'circle-color': signalColorExpression(),
          'circle-opacity':      0.85,
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.25)',
        },
      })
    }

    if (!map.getLayer('signal-symbols')) {
      map.addLayer({
        id: 'signal-symbols', type: 'symbol', source: 'signal-points',
        filter: ['!', ['has', 'point_count']],
        layout: {
          'text-field': signalSymbolExpression(),
          'text-size':             11,
          'text-anchor':           'center',
          'text-allow-overlap':    true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color':      '#ffffff',
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

    const PopupCtor = maplibreRef.current?.Popup
    if (!PopupCtor) return

    const popup = new PopupCtor({
      closeButton: false,
      closeOnClick: false,
      offset: 8,
      className: 'signal-popup-container',
    })

    const handleMouseEnter = (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      map.getCanvas().style.cursor = 'pointer'
      if (!e.features?.length) return
      const feature = e.features[0]
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
  }, [mapLoaded])

  // ---------------------------------------------------------------------------
  // Unified click handling — resolve exactly one interactive target per click
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const handleMapClick = (event: MapMouseEvent) => {
      const interactiveLayers = MAP_INTERACTIVE_LAYER_IDS.filter(layerId => map.getLayer(layerId))
      const features = map.queryRenderedFeatures(event.point, { layers: interactiveLayers })
      const resolved = resolveMapClickCandidate(features)
      if (!resolved) return

      if (resolved.kind === 'site') {
        const siteId = resolved.feature.properties?.id
        if (typeof siteId === 'string') {
          onSiteClickRef.current(siteId)
        }
        return
      }

      if (resolved.kind === 'asset') {
        const assetId = resolved.feature.properties?.id
        if (typeof assetId === 'string') {
          onAssetClickRef.current(assetId)
        }
        return
      }

      if (resolved.kind === 'signal') {
        const signalId = resolved.feature.properties?.id
        if (typeof signalId === 'string') {
          onSignalClickRef.current(signalId)
        }
        return
      }

      const source = map.getSource('signal-points') as GeoJSONSource | undefined
      if (!source) return
      void expandMapSignalCluster(map, source, resolved.feature as MapGeoJSONFeature)
    }

    map.on('click', handleMapClick)

    return () => {
      map.off('click', handleMapClick)
    }
  }, [mapLoaded])

  // ---------------------------------------------------------------------------
  // Vessel track polyline — removed/recreated when vesselTracks changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    // Always remove stale layer/source first (handles empty → populated and vice versa)
    if (map.getLayer('vessel-track-line')) map.removeLayer('vessel-track-line')
    if (map.getSource('vessel-track'))     map.removeSource('vessel-track')

    if (vesselTracks.length < 2) return

    const coords = vesselTracks.map(t => [Number(t.lng), Number(t.lat)])
    map.addSource('vessel-track', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
    })
    map.addLayer({
      id: 'vessel-track-line', type: 'line', source: 'vessel-track',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color':     SIGNAL_COLORS.vessel_position,
        'line-width':     2.5,
        'line-opacity':   0.80,
        'line-dasharray': [4, 3],
      },
    }, 'signal-glow')
  }, [mapLoaded, vesselTracks])

  // ---------------------------------------------------------------------------
  // Signal layer visibility — also clears selection when hidden
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const vis = showSignals ? 'visible' : 'none'
    const signalLayerIds = [
      'signal-clusters',
      'signal-cluster-count',
      'signal-glow',
      'signal-circles',
      'signal-symbols',
      'selected-signal-ring',
      'selected-signal-glow',
      'selected-signal-circle',
      'selected-signal-symbol',
    ]

    for (const layerId of signalLayerIds) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', vis)
    }

    // Synchronously clear selection when signals are hidden
    if (!showSignals) onSignalClickRef.current(null)
  }, [showSignals, mapLoaded])

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
  }, [showCoverage, mapLoaded])

  // ---------------------------------------------------------------------------
  // flyTo helper
  // ---------------------------------------------------------------------------
  const flyTo = useCallback((center: [number, number], zoom: number) => {
    mapRef.current?.flyTo({ center, zoom })
  }, [])

  const getZoom = useCallback(() => {
    const map = mapRef.current
    return map ? map.getZoom() : null
  }, [])

  const projectPosition = useCallback((lng: number, lat: number) => {
    const map = mapRef.current
    if (!map) return null

    const point = map.project([lng, lat])
    return { x: point.x, y: point.y }
  }, [])

  const inspectCanvasPosition = useCallback((x: number, y: number) => {
    const map = mapRef.current
    if (!map) return null

    const interactiveLayers = MAP_INTERACTIVE_LAYER_IDS.filter(layerId => map.getLayer(layerId))
    const features = map.queryRenderedFeatures([x, y], { layers: interactiveLayers })
    const resolved = resolveMapClickCandidate(features)
    if (!resolved) return null

    const rawId =
      resolved.kind === 'cluster'
        ? resolved.feature.properties?.cluster_id
        : resolved.feature.properties?.id

    return {
      kind: resolved.kind,
      id: rawId == null ? null : String(rawId),
      layerId: resolved.layerId,
    }
  }, [])

  return {
    mapLoaded,
    flyTo,
    getZoom,
    projectPosition,
    inspectCanvasPosition,
  }
}
