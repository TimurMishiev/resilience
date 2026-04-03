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
  GeoJSONSource,
  Map as MapLibreMap,
  MapGeoJSONFeature,
  MapMouseEvent,
  StyleSpecification,
} from 'maplibre-gl'
import type { Site, Task, Asset, Signal, AreaOfOperation, Chokepoint } from '../api/types'
import type { VesselTrack } from '../api/vessels'
import type { CoverageCircle } from '../lib/coverage'
import { useMapOverlays } from './map/useMapOverlays'
import { expandMapSignalCluster } from '../lib/mapSignalClustering'
import { ensureSignalLayers, updateSignalSources } from '../lib/mapEngineSignalLayers'
import { MAP_STYLE_CONFIGS, type MapStyleKey } from '../lib/mapEngineStyles'
export { MAP_STYLE_CONFIGS, type MapStyleKey }
import {
  MAP_INTERACTIVE_LAYER_IDS,
  resolveMapClickCandidate,
  type MapInteractiveKind,
} from '../lib/mapClickResolution'
import {
  buildAssetFeatureCollection,
  buildSiteFeatureCollection,
} from '../lib/mapRenderData'
import { buildMapSignalFeatureCollection, buildMapSignalRenderCollections } from '../lib/mapSignalRendering'
import { preloadMapRuntime } from '../lib/preloadRoutes'
import { ASSET_STATUS_COLORS, SIGNAL_COLORS } from '../lib/signalConfig'
import type { AssetTrail } from '../lib/telemetry'
import type { TelemetryMap } from '../lib/telemetry'

const EMPTY_READINGS: TelemetryMap = new Map()
export type MapLibreModule = typeof import('maplibre-gl')

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
  assetTrails:       AssetTrail[]
  coverageCircles:   CoverageCircle[]
  chokepoints:       Chokepoint[]
  readings:          TelemetryMap

  // Visibility toggles
  showSignals:  boolean
  showCoverage: boolean
  showHeatmap:     boolean
  showChokepoints: boolean
  showTrails:      boolean
  mapStyle:        MapStyleKey
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
  assetTrails,
  coverageCircles,
  chokepoints,
  readings,
  showSignals,
  showCoverage,
  showHeatmap,
  showChokepoints,
  showTrails,
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
  // Overlay layers — AO, geofence, breach, coverage, chokepoints
  // (delegated to useMapOverlays for maintainability)
  // ---------------------------------------------------------------------------
  useMapOverlays({
    mapRef, mapLoaded,
    sites, areaOfOperations, breachedSiteIds, coverageCircles, chokepoints,
    showCoverage, showChokepoints,
  })

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
    updateSignalSources(map, clusterable, selected, buildMapSignalFeatureCollection(signals))
  }, [mapLoaded, selectedSignalId, signals])

  // ---------------------------------------------------------------------------
  // Signal GeoJSON layers + interactions — set up once per style load
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const signalCollections = buildMapSignalRenderCollections(signalsRef.current, selectedSignalIdRef.current)
    return ensureSignalLayers(
      map,
      maplibreRef.current?.Popup,
      signalCollections.clusterable,
      signalCollections.selected,
      buildMapSignalFeatureCollection(signalsRef.current),
    )
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
  // Asset trails — one LineString per asset, colored by status, replay-only.
  // Uses setData() on the existing source to avoid layer flicker on asOf changes.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const featureCollection = {
      type: 'FeatureCollection' as const,
      features: assetTrails
        .filter(trail => trail.points.length >= 2)
        .map(trail => ({
          type: 'Feature' as const,
          properties: { status: trail.status, name: trail.name },
          geometry: {
            type: 'LineString' as const,
            coordinates: trail.points.map(p => [p.lng, p.lat]),
          },
        })),
    }

    // If source already exists, patch data in-place — no layer flicker
    const existingSource = map.getSource('asset-trails') as GeoJSONSource | undefined
    if (existingSource) {
      if (featureCollection.features.length === 0) {
        if (map.getLayer('asset-trail-line')) map.removeLayer('asset-trail-line')
        map.removeSource('asset-trails')
      } else {
        existingSource.setData(featureCollection)
      }
      return
    }

    if (featureCollection.features.length === 0) return

    // First render: add source + layer
    map.addSource('asset-trails', { type: 'geojson', data: featureCollection })
    map.addLayer({
      id: 'asset-trail-line',
      type: 'line',
      source: 'asset-trails',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'status'],
          'available', ASSET_STATUS_COLORS['available'],
          'assigned',  ASSET_STATUS_COLORS['assigned'],
          'degraded',  ASSET_STATUS_COLORS['degraded'],
          ASSET_STATUS_COLORS['offline'], // fallback
        ],
        'line-width':  2,
        'line-opacity': 0.7,
      },
    }, 'signal-glow')
  }, [mapLoaded, assetTrails])

  // ---------------------------------------------------------------------------
  // Asset trail visibility toggle — mirrors showSignals pattern
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (!map.getLayer('asset-trail-line')) return
    map.setLayoutProperty('asset-trail-line', 'visibility', showTrails ? 'visible' : 'none')
  }, [mapLoaded, showTrails])

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
  // Heatmap visibility — derived from both signal visibility and heatmap toggle
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !map.getLayer('signal-heatmap')) return
    map.setLayoutProperty('signal-heatmap', 'visibility', showSignals && showHeatmap ? 'visible' : 'none')
  }, [showHeatmap, showSignals, mapLoaded])


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
