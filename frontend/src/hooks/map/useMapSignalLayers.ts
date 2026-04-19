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
    if (!perfEnabled) return

    const jsMs = nowMs() - startedAt
    const previousSignalCount = previousSignalCountRef.current
    const previousSelectedSignalId = previousSelectedSignalIdRef.current
    const signalCountDelta = signals.length - previousSignalCount
    const selectionChanged = selectedSignalId !== previousSelectedSignalId
    // Trigger priority when multiple inputs change in the same render:
    // selection change > signal-count change > reference-time change.
    // The Playwright `benchmark:map` spec filters to `selection_set`, so
    // this ordering guarantees selection-driven samples aren't masked by
    // a concurrent signal-array or replay-clock update.
    const trigger =
      selectionChanged ? (selectedSignalId ? 'selection_set' : 'selection_cleared')
      : signalCountDelta !== 0 ? 'signals_changed'
      : 'reference_time_changed'

    const details = { signalCount: signals.length, signalCountDelta, selectedSignalId, selectionChanged, trigger, jsMs }

    // Wait two animation frames before recording so durationMs captures
    // operator-felt time-to-paint (JS reconcile + style/layout + composite),
    // not just the synchronous bookkeeping cost.  The first rAF fires
    // before paint; the second fires after paint of the first frame.  jsMs
    // remains in details so a regression in the synchronous reconcile is
    // still observable even though the headline number is paint-bound.
    //
    // Refs only commit on successful paint-completion — if this effect is
    // torn down before rAF fires (e.g. a concurrent signals/ref-time render
    // preempts the paint), the selection change survives into the next fire
    // and is still reported as selection_set rather than silently swallowed.
    const raf  = typeof window !== 'undefined' ? window.requestAnimationFrame : undefined
    const caf  = typeof window !== 'undefined' ? window.cancelAnimationFrame  : undefined
    if (!raf || !caf) {
      previousSignalCountRef.current = signals.length
      previousSelectedSignalIdRef.current = selectedSignalId
      recordPerfEvent('map.signal_reconcile', details, jsMs)
      return
    }

    let inner = 0
    const outer = raf(() => {
      inner = raf(() => {
        previousSignalCountRef.current = signals.length
        previousSelectedSignalIdRef.current = selectedSignalId
        recordPerfEvent('map.signal_reconcile', details, nowMs() - startedAt)
      })
    })
    return () => {
      caf(outer)
      if (inner) caf(inner)
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
