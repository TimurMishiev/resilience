/**
 * useMapSignalLayers
 *
 * Manages all signal-related GeoJSON sources, layers, visibility toggles,
 * and heatmap rendering on the MapLibre map.
 *
 * Extracted from useMapLibreEngine to keep the orchestrator focused on
 * lifecycle, click dispatch, and camera.
 */

import { useEffect, useRef, type MutableRefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Signal } from '../../api/types'
import { ensureSignalLayers, updateSignalSources } from '../../lib/mapEngineSignalLayers'
import { buildMapSignalFeatureCollection, buildMapSignalRenderCollections } from '../../lib/mapSignalRendering'
import type { MapLibreModule } from '../useMapLibreEngine'

export interface MapSignalLayersInput {
  mapRef:            MutableRefObject<MapLibreMap | null>
  maplibreRef:       MutableRefObject<MapLibreModule | null>
  mapLoaded:         boolean
  signals:           Signal[]
  selectedSignalId:  string | null
  showSignals:       boolean
  showHeatmap:       boolean
  onSignalClickRef:  MutableRefObject<(signalId: string | null) => void>
}

export function useMapSignalLayers({
  mapRef,
  maplibreRef,
  mapLoaded,
  signals,
  selectedSignalId,
  showSignals,
  showHeatmap,
  onSignalClickRef,
}: MapSignalLayersInput) {
  const signalsRef = useRef<Signal[]>([])
  const selectedSignalIdRef = useRef<string | null>(selectedSignalId)

  useEffect(() => { signalsRef.current = signals }, [signals])
  useEffect(() => { selectedSignalIdRef.current = selectedSignalId }, [selectedSignalId])

  // Signal GeoJSON source data
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const { clusterable, selected } = buildMapSignalRenderCollections(signals, selectedSignalId)
    updateSignalSources(map, clusterable, selected, buildMapSignalFeatureCollection(signals))
  }, [mapLoaded, selectedSignalId, signals, mapRef])

  // Signal GeoJSON layers + interactions — set up once per style load
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
  }, [mapLoaded, mapRef, maplibreRef])

  // Signal layer visibility
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

    if (!showSignals) onSignalClickRef.current(null)
  }, [showSignals, mapLoaded, mapRef, onSignalClickRef])

  // Heatmap visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !map.getLayer('signal-heatmap')) return
    map.setLayoutProperty('signal-heatmap', 'visibility', showSignals && showHeatmap ? 'visible' : 'none')
  }, [showHeatmap, showSignals, mapLoaded, mapRef])
}
