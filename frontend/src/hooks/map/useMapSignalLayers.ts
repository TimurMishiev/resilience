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
import { isPerfEnabled, nowMs, recordPerfEvent } from '../../lib/perfInstrumentation'
import type { MapLibreModule } from '../useMapLibreEngine'

export interface MapSignalLayersInput {
  mapRef:            MutableRefObject<MapLibreMap | null>
  maplibreRef:       MutableRefObject<MapLibreModule | null>
  mapLoaded:         boolean
  signals:           Signal[]
  selectedSignalId:  string | null
  referenceTimeMs:   number
  showSignals:       boolean
  showHeatmap:       boolean
  onSignalClickRef:  MutableRefObject<(signalId: string | null) => void>
  evidenceSignalIds: string[]
}

export function useMapSignalLayers({
  mapRef,
  maplibreRef,
  mapLoaded,
  signals,
  selectedSignalId,
  referenceTimeMs,
  showSignals,
  showHeatmap,
  onSignalClickRef,
  evidenceSignalIds,
}: MapSignalLayersInput) {
  const signalsRef = useRef<Signal[]>([])
  const selectedSignalIdRef = useRef<string | null>(selectedSignalId)
  const referenceTimeMsRef = useRef(referenceTimeMs)

  useEffect(() => { signalsRef.current = signals }, [signals])
  useEffect(() => { selectedSignalIdRef.current = selectedSignalId }, [selectedSignalId])
  useEffect(() => { referenceTimeMsRef.current = referenceTimeMs }, [referenceTimeMs])

  // Signal GeoJSON source data
  const previousSignalCountRef = useRef<number>(0)
  const previousSelectedSignalIdRef = useRef<string | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const perfEnabled = isPerfEnabled()
    const startedAt = perfEnabled ? nowMs() : 0
    const { clusterable, selected } = buildMapSignalRenderCollections(signals, selectedSignalId, referenceTimeMs)
    updateSignalSources(map, clusterable, selected, buildMapSignalFeatureCollection(signals, referenceTimeMs))
    if (perfEnabled) {
      const previousSignalCount = previousSignalCountRef.current
      const previousSelectedSignalId = previousSelectedSignalIdRef.current
      const signalCountDelta = signals.length - previousSignalCount
      const selectionChanged = selectedSignalId !== previousSelectedSignalId
      recordPerfEvent(
        'map.signal_reconcile',
        {
          signalCount: signals.length,
          signalCountDelta,
          selectedSignalId,
          selectionChanged,
          trigger:
            selectionChanged ? (selectedSignalId ? 'selection_set' : 'selection_cleared')
            : signalCountDelta !== 0 ? 'signals_changed'
            : 'reference_time_changed',
        },
        nowMs() - startedAt,
      )
      previousSignalCountRef.current = signals.length
      previousSelectedSignalIdRef.current = selectedSignalId
    }
  }, [mapLoaded, selectedSignalId, signals, referenceTimeMs, mapRef])

  // Signal GeoJSON layers + interactions — set up once per style load
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const signalCollections = buildMapSignalRenderCollections(signalsRef.current, selectedSignalIdRef.current, referenceTimeMsRef.current)
    return ensureSignalLayers(
      map,
      maplibreRef.current?.Popup,
      signalCollections.clusterable,
      signalCollections.selected,
      buildMapSignalFeatureCollection(signalsRef.current, referenceTimeMsRef.current),
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
      'signal-evidence-ring',
    ]

    for (const layerId of signalLayerIds) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', vis)
    }

    if (!showSignals) onSignalClickRef.current(null)
  }, [showSignals, mapLoaded, mapRef, onSignalClickRef])

  // Evidence ring layer — highlights signals linked to a selected site via rule matches
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    if (!map.getLayer('signal-evidence-ring')) {
      map.addLayer({
        id: 'signal-evidence-ring',
        type: 'circle',
        source: 'signal-points',
        filter: ['all', ['!', ['has', 'point_count']], ['in', ['get', 'id'], ['literal', []]]],
        paint: {
          'circle-radius': 12,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#f5a623',
          'circle-stroke-opacity': 0.8,
          'circle-blur': 0.2,
        },
      })
    }

    map.setFilter(
      'signal-evidence-ring',
      evidenceSignalIds.length > 0
        ? ['all', ['!', ['has', 'point_count']], ['in', ['get', 'id'], ['literal', evidenceSignalIds]]]
        : ['all', ['!', ['has', 'point_count']], ['in', ['get', 'id'], ['literal', []]]],
    )
  }, [mapLoaded, evidenceSignalIds, mapRef])

  // Heatmap visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !map.getLayer('signal-heatmap')) return
    map.setLayoutProperty('signal-heatmap', 'visibility', showSignals && showHeatmap ? 'visible' : 'none')
  }, [showHeatmap, showSignals, mapLoaded, mapRef])
}
