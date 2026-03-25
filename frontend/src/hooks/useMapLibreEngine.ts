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
import { assetDisplayPosition } from '../lib/assetPresentation'
import { buildClusteredSignalSourceDefinition, expandMapSignalCluster } from '../lib/mapSignalClustering'
import { buildMapSignalRenderCollections } from '../lib/mapSignalRendering'
import { preloadMapRuntime } from '../lib/preloadRoutes'
import { SIGNAL_ICON_CHAR } from '../lib/signalIcons'
import { SOURCE_LABELS, SIGNAL_COLORS, SIGNAL_LABELS } from '../lib/signalConfig'
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

// ---------------------------------------------------------------------------
// Helpers (module-scope — no React deps)
// ---------------------------------------------------------------------------

function siteHealthKey(tasks: Task[], siteStatus: Site['status']): string {
  if (siteStatus === 'inactive') return 'inactive'
  if (tasks.length === 0)        return 'active'
  const hasBlocked    = tasks.some(t => t.workflow_status === 'blocked')
  const allResolved   = tasks.every(t => t.workflow_status === 'resolved')
  const hasInProgress = tasks.some(t => t.workflow_status === 'in_progress')
  if (hasBlocked)    return 'blocked'
  if (allResolved)   return 'resolved'
  if (hasInProgress) return 'in_progress'
  return 'active'
}

function siteHealthColor(health: string): string {
  switch (health) {
    case 'blocked': return '#ff5c5c'
    case 'resolved': return '#2fd46b'
    case 'in_progress': return '#35a7ff'
    case 'inactive': return '#6b7280'
    default: return '#2fd46b'
  }
}

function assetTypeIcon(type: Asset['asset_type']): string {
  switch (type) {
    case 'vehicle':   return '🚗'
    case 'equipment': return '📡'
    case 'personnel': return '🪖'
    default:          return '●'
  }
}

function appendPopupRow(container: HTMLElement, label: string, value: string, valueColor?: string) {
  const row = document.createElement('span')
  row.className = 'sp-row'
  const labelEl = document.createElement('span')
  labelEl.textContent = label
  const valueEl = document.createElement('b')
  valueEl.textContent = value
  if (valueColor) valueEl.style.color = valueColor
  row.append(labelEl, valueEl)
  container.appendChild(row)
}

function buildSignalPopupContent(props: Record<string, string>) {
  const root = document.createElement('div')
  root.className = 'signal-popup'

  const header = document.createElement('div')
  header.className = 'sp-header'
  header.style.borderLeft = `3px solid ${SIGNAL_COLORS[props.signal_type] ?? '#8f99a8'}`

  const icon = document.createElement('span')
  icon.className = 'sp-icon'
  icon.textContent = SIGNAL_ICON_CHAR[props.signal_type] ?? '●'

  const type = document.createElement('span')
  type.className = 'sp-type'
  type.textContent =
    props.signal_type === 'disaster_alert' && props.p_name
      ? props.p_name
      : (SIGNAL_LABELS[props.signal_type] ?? props.signal_type)

  header.append(icon, type)

  const body = document.createElement('div')
  body.className = 'sp-body'

  appendPopupRow(body, 'Source', SOURCE_LABELS[props.source] ?? props.source)

  if (props.signal_type === 'conflict_event') {
    if (props.p_country)    appendPopupRow(body, 'Country', props.p_country)
    if (props.p_actor1)     appendPopupRow(body, 'Actor', props.p_actor1)
    if (props.p_fatalities != null) appendPopupRow(body, 'Fatalities', props.p_fatalities)
  } else if (props.signal_type === 'disaster_alert') {
    if (props.p_event_type_name) appendPopupRow(body, 'Type', props.p_event_type_name)
    if (props.p_country)         appendPopupRow(body, 'Country', props.p_country)
    if (props.p_alert_level) {
      const alertColor =
        props.p_alert_level === 'Red'    ? '#ff4444'
        : props.p_alert_level === 'Orange' ? '#ff9800'
        : '#4caf50'
      appendPopupRow(body, 'Alert', props.p_alert_level, alertColor)
    }
    if (props.p_severity_text) appendPopupRow(body, 'Severity', props.p_severity_text)
  } else {
    if (props.magnitude) appendPopupRow(body, 'Magnitude', Number(props.magnitude).toFixed(1))
    if (props.altitude)  appendPopupRow(body, 'Altitude', `${Number(props.altitude).toFixed(0)} m`)
    if (props.speed)     appendPopupRow(body, 'Speed', `${Number(props.speed).toFixed(0)} kn`)
  }

  if (props.occurred_at) {
    appendPopupRow(body, 'Time', new Date(props.occurred_at).toLocaleTimeString())
  }

  const hint = document.createElement('span')
  hint.className = 'sp-hint'
  hint.textContent = 'Click for details'
  body.appendChild(hint)

  root.append(header, body)
  return root
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

function buildSiteFeatureCollection(
  sites: Site[],
  tasksBySite: Record<string, Task[]>,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: sites.map(site => {
      const health = siteHealthKey(tasksBySite[site.id] ?? [], site.status)
      return {
        type: 'Feature' as const,
        properties: {
          id: site.id,
          name: site.name,
          health,
          color: siteHealthColor(health),
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [Number(site.longitude), Number(site.latitude)],
        },
      }
    }),
  }
}

function buildAssetFeatureCollection(
  assets: Asset[],
  sites: Site[],
  readings: TelemetryMap,
  allowHistoricalTelemetry = false,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: assets.map(asset => {
      const { lat, lng } = assetDisplayPosition(
        asset,
        sites,
        readings,
        { lat: 37.7749, lng: -122.4194 },
        { allowHistorical: allowHistoricalTelemetry },
      )
      return {
        type: 'Feature' as const,
        properties: {
          id: asset.id,
          name: asset.name,
          asset_type: asset.asset_type,
          status: asset.status,
          icon: assetTypeIcon(asset.asset_type),
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [lng, lat],
        },
      }
    }),
  }
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

    const handleSiteClick = (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      const siteId = e.features?.[0]?.properties?.id
      if (typeof siteId !== 'string') return
      onAssetClickRef.current(null)
      onSignalClickRef.current(null)
      onSiteClickRef.current(siteId)
    }

    const handleMouseEnter = () => { map.getCanvas().style.cursor = 'pointer' }
    const handleMouseLeave = () => { map.getCanvas().style.cursor = '' }

    map.on('click', 'site-circles', handleSiteClick)
    map.on('mouseenter', 'site-circles', handleMouseEnter)
    map.on('mouseleave', 'site-circles', handleMouseLeave)

    return () => {
      map.off('click', 'site-circles', handleSiteClick)
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

    const handleAssetClick = (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      const assetId = e.features?.[0]?.properties?.id
      if (typeof assetId !== 'string') return
      onSiteClickRef.current(null)
      onSignalClickRef.current(null)
      onAssetClickRef.current(assetId)
    }

    const handleMouseEnter = () => { map.getCanvas().style.cursor = 'pointer' }
    const handleMouseLeave = () => { map.getCanvas().style.cursor = '' }

    map.on('click', 'asset-circles', handleAssetClick)
    map.on('click', 'asset-symbols', handleAssetClick)
    map.on('mouseenter', 'asset-circles', handleMouseEnter)
    map.on('mouseenter', 'asset-symbols', handleMouseEnter)
    map.on('mouseleave', 'asset-circles', handleMouseLeave)
    map.on('mouseleave', 'asset-symbols', handleMouseLeave)

    return () => {
      map.off('click', 'asset-circles', handleAssetClick)
      map.off('click', 'asset-symbols', handleAssetClick)
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

    // Signal click — reads signalsRef so it never goes stale
    const handleSignalClick = (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return
      const props = e.features[0].properties
      const sig   = signalsRef.current.find(s => s.id === props.id)
      if (!sig) return
      onSiteClickRef.current(null)
      onAssetClickRef.current(null)
      onSignalClickRef.current(sig.id)
    }

    const handleClusterClick = (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return
      const source = map.getSource('signal-points') as GeoJSONSource | undefined
      if (!source) return
      void expandMapSignalCluster(map, source, e.features[0])
    }

    const handleClusterMouseEnter = () => { map.getCanvas().style.cursor = 'pointer' }
    const handleClusterMouseLeave = () => { map.getCanvas().style.cursor = '' }

    map.on('click', 'signal-clusters', handleClusterClick)
    map.on('mouseenter', 'signal-clusters', handleClusterMouseEnter)
    map.on('mouseleave', 'signal-clusters', handleClusterMouseLeave)
    map.on('click', 'signal-circles', handleSignalClick)
    map.on('click', 'signal-symbols', handleSignalClick)
    map.on('click', 'selected-signal-circle', handleSignalClick)
    map.on('click', 'selected-signal-symbol', handleSignalClick)

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
      const props  = e.features[0].properties as Record<string, string>
      const coords = (e.features[0].geometry as unknown as { coordinates: [number, number] }).coordinates
      popup.setLngLat(coords).setDOMContent(buildSignalPopupContent(props)).addTo(map)
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
      map.off('click', 'signal-clusters', handleClusterClick)
      map.off('click',      'signal-circles', handleSignalClick)
      map.off('click',      'signal-symbols', handleSignalClick)
      map.off('click',      'selected-signal-circle', handleSignalClick)
      map.off('click',      'selected-signal-symbol', handleSignalClick)
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

  return {
    mapLoaded,
    flyTo,
  }
}
