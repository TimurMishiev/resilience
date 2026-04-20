/**
 * useMapLibreEngine
 *
 * Owns all MapLibre GL lifecycle: map init, style switching, click handling,
 * and signal layer visibility.
 *
 * Entity/layer management is delegated to sub-hooks:
 *  - useMapSiteLayers    — site GeoJSON source/layers + selection ring
 *  - useMapAssetLayers   — asset GeoJSON source/layers + selection ring
 *  - useMapOverlays      — AO polygons, geofence, breach, coverage, chokepoints
 *  - useMapTrackLayers   — vessel track + asset trail polylines
 *  - useMapSignalLayers  — signal sources, layers, visibility, heatmap
 *
 * Design contract:
 *  - Imperative: all effects are internal; the caller passes data + callbacks.
 *  - Callback-driven: map-click events surface through onSiteClick /
 *    onAssetClick / onSignalClick; the page owns all selection state.
 *  - Ref-wrapped callbacks: each callback is mirrored into a ref so the one-
 *    time handler registrations (signal layer, style.load) never go stale
 *    without needing to be re-registered.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
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
import { useMapSiteLayers } from './map/useMapSiteLayers'
import { useMapAssetLayers } from './map/useMapAssetLayers'
import { useMapTrackLayers } from './map/useMapTrackLayers'
import { useMapMeasurementLayers } from './map/useMapMeasurementLayers'
import { useMapSignalLayers } from './map/useMapSignalLayers'
import { expandMapSignalCluster } from '../lib/mapSignalClustering'
import { MAP_STYLE_CONFIGS, type MapStyleKey } from '../lib/mapEngineStyles'
export { MAP_STYLE_CONFIGS, type MapStyleKey }
import {
  MAP_INTERACTIVE_LAYER_IDS,
  resolveMapClickCandidate,
  type MapInteractiveKind,
} from '../lib/mapClickResolution'
import { preloadMapRuntime } from '../lib/preloadRoutes'
import type { AssetTrail } from '../lib/telemetry'
import type { TelemetryMap } from '../lib/telemetry'
import type { MapMeasurementPoint } from '../lib/mapMeasurement'

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
  referenceTimeMs: number
  selectedSiteId:   string | null
  selectedAssetId:  string | null
  selectedSignalId: string | null
  measurementMode:  boolean
  measurementPoints: MapMeasurementPoint[]

  // Evidence-linked entity IDs (from signal rule matches)
  evidenceSignalIds: string[]
  evidenceSiteIds:   string[]

  // Selection callbacks — hook fires, page owns state
  onSiteClick:   (siteId: string | null) => void
  onAssetClick:  (assetId: string | null) => void
  onSignalClick: (signalId: string | null) => void
  onMapCoordinateClick: (point: MapMeasurementPoint) => void
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
  /** Forces MapLibre to re-measure its container. Call after layout changes. */
  resize: () => void
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
  referenceTimeMs,
  selectedSiteId,
  selectedAssetId,
  selectedSignalId,
  measurementMode,
  measurementPoints,
  evidenceSignalIds,
  evidenceSiteIds,
  onSiteClick,
  onAssetClick,
  onSignalClick,
  onMapCoordinateClick,
}: MapEngineInput): MapEngineReturn {
  const mapRef           = useRef<MapLibreMap | null>(null)
  const maplibreRef      = useRef<MapLibreModule | null>(null)
  const mapStyleRef      = useRef<MapStyleKey>(mapStyle)
  const appliedStyleRef  = useRef<MapStyleKey | null>(null)

  const [mapLoaded, setMapLoaded] = useState(false)

  // Mirror callbacks into refs so one-time handler registrations stay current
  const onSiteClickRef   = useRef(onSiteClick)
  const onAssetClickRef  = useRef(onAssetClick)
  const onSignalClickRef = useRef(onSignalClick)
  const onMapCoordinateClickRef = useRef(onMapCoordinateClick)
  const measurementModeRef = useRef(measurementMode)
  useEffect(() => { onSiteClickRef.current   = onSiteClick   }, [onSiteClick])
  useEffect(() => { onAssetClickRef.current  = onAssetClick  }, [onAssetClick])
  useEffect(() => { onSignalClickRef.current = onSignalClick }, [onSignalClick])
  useEffect(() => { onMapCoordinateClickRef.current = onMapCoordinateClick }, [onMapCoordinateClick])
  useEffect(() => { measurementModeRef.current = measurementMode }, [measurementMode])
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
  // Style switching
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (appliedStyleRef.current === mapStyle) return
    setMapLoaded(false)
    appliedStyleRef.current = mapStyle
    map.setStyle(MAP_STYLE_CONFIGS[mapStyle].style as StyleSpecification)
    map.once('style.load', () => setMapLoaded(true))
  }, [mapStyle])

  // ---------------------------------------------------------------------------
  // Cross-entity spatial linking
  // ---------------------------------------------------------------------------
  const selectedAssetHomeSiteId = useMemo(
    () => assets.find(a => a.id === selectedAssetId)?.home_site_id ?? null,
    [assets, selectedAssetId],
  )

  // ---------------------------------------------------------------------------
  // Sub-hooks — layer management delegated for maintainability
  // ---------------------------------------------------------------------------
  useMapSiteLayers({
    mapRef, mapLoaded, sites, tasksBySite, selectedSiteId,
    linkedSiteId: selectedAssetHomeSiteId,
    evidenceSiteIds,
  })

  useMapAssetLayers({
    mapRef, mapLoaded, sites, assets, readings, isReplaying, referenceTimeMs, selectedAssetId,
    linkedSiteId: selectedSiteId,
  })

  useMapOverlays({
    mapRef, mapLoaded,
    sites, areaOfOperations, breachedSiteIds, coverageCircles, chokepoints,
    showCoverage, showChokepoints,
  })

  useMapTrackLayers({
    mapRef, mapLoaded, vesselTracks, assetTrails, showTrails,
  })

  useMapSignalLayers({
    mapRef, maplibreRef, mapLoaded, signals, selectedSignalId, referenceTimeMs,
    showSignals, showHeatmap, onSignalClickRef,
    evidenceSignalIds,
  })

  useMapMeasurementLayers({
    mapRef,
    mapLoaded,
    points: measurementPoints,
  })

  // ---------------------------------------------------------------------------
  // Unified click handling
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const handleMapClick = (event: MapMouseEvent) => {
      if (measurementModeRef.current) {
        onMapCoordinateClickRef.current({
          lng: event.lngLat.lng,
          lat: event.lngLat.lat,
        })
        return
      }

      const interactiveLayers = MAP_INTERACTIVE_LAYER_IDS.filter(layerId => map.getLayer(layerId))
      const features = map.queryRenderedFeatures(event.point, { layers: interactiveLayers })
      const resolved = resolveMapClickCandidate(features)
      if (!resolved) return

      if (resolved.kind === 'site') {
        const siteId = resolved.feature.properties?.id
        if (typeof siteId === 'string') onSiteClickRef.current(siteId)
        return
      }

      if (resolved.kind === 'asset') {
        const assetId = resolved.feature.properties?.id
        if (typeof assetId === 'string') onAssetClickRef.current(assetId)
        return
      }

      if (resolved.kind === 'signal') {
        const signalId = resolved.feature.properties?.id
        if (typeof signalId === 'string') onSignalClickRef.current(signalId)
        return
      }

      const source = map.getSource('signal-points') as GeoJSONSource | undefined
      if (!source) return
      void expandMapSignalCluster(map, source, resolved.feature as MapGeoJSONFeature)
    }

    map.on('click', handleMapClick)
    return () => { map.off('click', handleMapClick) }
  }, [mapLoaded])

  // ---------------------------------------------------------------------------
  // Return values
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

  const resize = useCallback(() => {
    mapRef.current?.resize()
  }, [])

  return {
    mapLoaded,
    flyTo,
    getZoom,
    projectPosition,
    inspectCanvasPosition,
    resize,
  }
}
