/**
 * useMapReplayPulseLayers — Tranche 6-A.
 *
 * Mounts the replay-pulse source/layers on the MapLibre map when
 * showReplayPulses is true; removes them when it goes false. While
 * mounted, it advances a sinusoidal breath value via requestAnimationFrame
 * so all pulses pulse together. The animation loop only runs while the
 * layer is mounted AND there are pulses to drive — live mode and empty
 * windows pay zero per-frame cost.
 */

import { useEffect, useRef, type MutableRefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import {
  applyReplayPulseBreath,
  ensureReplayPulseLayers,
  removeReplayPulseLayers,
  updateReplayPulseSources,
} from '../../lib/mapEngineReplayPulseLayers'
import type { Pulse } from '../../lib/replayEventPulses'

export interface MapReplayPulseLayersInput {
  mapRef: MutableRefObject<MapLibreMap | null>
  mapLoaded: boolean
  pulses: readonly Pulse[]
  showReplayPulses: boolean
}

export function useMapReplayPulseLayers({
  mapRef,
  mapLoaded,
  pulses,
  showReplayPulses,
}: MapReplayPulseLayersInput) {
  const pulsesRef = useRef<readonly Pulse[]>(pulses)
  useEffect(() => {
    pulsesRef.current = pulses
  }, [pulses])

  // Mount/unmount + source-data updates.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    if (!showReplayPulses) {
      removeReplayPulseLayers(map)
      return
    }

    ensureReplayPulseLayers(map, pulses)
    updateReplayPulseSources(map, pulses)
  }, [mapRef, mapLoaded, showReplayPulses, pulses])

  // Breathing animation — only runs while the layer is mounted and there
  // are pulses to drive. cancelAnimationFrame on every dep change keeps
  // the loop honest under hot reloads and rapid prop churn.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !showReplayPulses) return
    if (typeof window === 'undefined' || !window.requestAnimationFrame) return
    if (pulses.length === 0) return

    let rafHandle = 0
    let phase = 0

    const tick = () => {
      phase += 0.05
      applyReplayPulseBreath(map, pulsesRef.current, phase)
      rafHandle = window.requestAnimationFrame(tick)
    }
    rafHandle = window.requestAnimationFrame(tick)

    return () => {
      if (rafHandle) window.cancelAnimationFrame(rafHandle)
    }
  }, [mapRef, mapLoaded, showReplayPulses, pulses.length])
}
