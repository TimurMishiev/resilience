/**
 * useGlobeReplayPulseLayers — Tranche 6-B.
 *
 * Cesium parity for the replay event-pulse layer that 6-A shipped on `/map`.
 * Same `Pulse[]` data shape (from useReplayEventPulses), same five
 * high-signal event types, same colour palette (PULSE_COLORS), same
 * past-only narrative — the visible difference is just that this surface
 * renders pulses on the globe instead of the map.
 *
 * Shape (deliberately separate from useGlobeSignalPrimitives per the
 * 6-B scoping decision — keeps lifecycle, cleanup, and future 6-D halo
 * work isolated):
 *
 *   - dedicated `PointPrimitiveCollection` owned entirely by this hook
 *     (created on viewerReady, destroyed on unmount)
 *   - per-pulse halo + core primitives stored in `Map<string, { halo, core }>`
 *     for visual parity with the map's two-layer halo+core aesthetic
 *   - dedicated `scene.preRender` listener that walks the map each frame
 *     and updates pixelSize + colour.alpha from a sine wave; mirrors the
 *     time math in `breachPulseColorProperty()` (1260ms full cycle) so
 *     map and globe pulse cadence feel intentional, not coincidentally
 *     different
 *   - `id: undefined` on every primitive so they cannot steal click picks
 *     from sites/signals (relies on `pickIdString` filtering non-string
 *     ids, see globeEngineHelpers.ts:339)
 *
 * Live-mode + empty-pulses path: zero per-frame cost. The preRender
 * listener is only registered while the layer is mounted AND has pulses.
 */

import { useEffect, useRef } from 'react'
import type * as CesiumType from 'cesium'
import {
  prunePrimitiveMap,
  type CesiumModule,
} from '../../lib/globeEngineHelpers'
import { PULSE_COLORS, type Pulse } from '../../lib/replayEventPulses'

export interface GlobeReplayPulseLayersInput {
  viewerRef:        React.RefObject<CesiumType.Viewer | null>
  cesiumRef:        React.RefObject<CesiumModule | null>
  viewerReady:      boolean
  pulses:           readonly Pulse[]
  showReplayPulses: boolean
}

interface PulsePrimitives {
  halo: CesiumType.PointPrimitive
  core: CesiumType.PointPrimitive
}

// Halo + core sizing. Halo is the breathing element; core is the steady
// solid dot with a white outline. Visual parity target: the same operator
// gestalt as the map pulses — a soft halo around a clear focal dot.
const HALO_BASE_PX  = 8
const HALO_RANGE_PX = 24
const CORE_BASE_PX  = 3
const CORE_RANGE_PX = 4
const HALO_BASE_ALPHA = 0.18
const CORE_BASE_ALPHA = 0.95
const CORE_OUTLINE_BASE_ALPHA = 0.8

/**
 * Mirrors the time math in `breachPulseColorProperty` so the breach pulse
 * (used on flagged sites) and the replay event pulse share a cadence.
 * Sine of `(t/630) * π` has a full cycle every 1260ms — a slow, legible
 * breath that reads as "alive" without being distracting.
 */
function breathFraction(timeMs: number): number {
  // 0.0 ↔ 1.0 with the same phase as breachPulseColorProperty's `opacity`.
  return 0.5 + 0.5 * Math.sin((timeMs / 630) * Math.PI)
}

function timeMsFromJulianDate(
  Cesium: CesiumModule,
  time: unknown,
): number {
  if (
    time != null
    && 'JulianDate' in Cesium
    && Cesium.JulianDate != null
    && typeof Cesium.JulianDate.toDate === 'function'
  ) {
    return Cesium.JulianDate.toDate(time as CesiumType.JulianDate).getTime()
  }
  return Date.now()
}

export function useGlobeReplayPulseLayers({
  viewerRef,
  cesiumRef,
  viewerReady,
  pulses,
  showReplayPulses,
}: GlobeReplayPulseLayersInput): void {
  const collectionRef = useRef<CesiumType.PointPrimitiveCollection | null>(null)
  const pulsePrimitivesRef = useRef<Map<string, PulsePrimitives>>(new Map())
  // Mirrors `useMapReplayPulseLayers`'s pulsesRef: lets the preRender
  // listener read the latest pulses without re-registering on every
  // pulse-content change.
  const pulsesRef = useRef<readonly Pulse[]>(pulses)
  useEffect(() => {
    pulsesRef.current = pulses
  }, [pulses])

  // Dedicated collection lifecycle. Sub-hook owns it end-to-end so the
  // engine doesn't need to know pulses exist. Mounted only while
  // showReplayPulses is true; teardown removes every primitive AND the
  // collection itself from the scene.
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return
    if (!showReplayPulses) return

    const collection = new Cesium.PointPrimitiveCollection()
    viewer.scene.primitives.add(collection)
    collectionRef.current = collection
    // Capture the primitive map at effect-mount time so the cleanup uses
    // the same Map instance even if the ref's `.current` is reassigned
    // elsewhere (defensive — useRef gives a stable container, but the
    // lint warning prefers an explicit local binding here).
    const primitiveMap = pulsePrimitivesRef.current

    return () => {
      // The viewer's destroy() teardown (see useGlobeEngine cleanup)
      // already destroys child primitives; guard so we don't double-remove.
      if (!viewer.isDestroyed()) {
        viewer.scene.primitives.remove(collection)
      }
      primitiveMap.clear()
      collectionRef.current = null
    }
  }, [viewerReady, showReplayPulses, viewerRef, cesiumRef])

  // Pulse churn. As the cursor crosses bucket boundaries new pulse ids
  // appear and old ones drop; mid-bucket the same ids re-render with
  // updated intensity. Same prune-then-update-or-add shape as
  // useGlobeSignalPrimitives.
  useEffect(() => {
    const Cesium = cesiumRef.current
    const collection = collectionRef.current
    if (!viewerReady || !Cesium || !collection) return
    if (!showReplayPulses) {
      // Drain so a re-mount starts clean. The collection itself is
      // already torn down by the lifecycle effect above.
      pulsePrimitivesRef.current.clear()
      return
    }

    const currentIds = new Set<string>()
    for (const pulse of pulses) currentIds.add(pulse.id)

    // Prune halos AND cores for vanished pulses.
    for (const [id, primitives] of pulsePrimitivesRef.current) {
      if (!currentIds.has(id)) {
        collection.remove(primitives.halo)
        collection.remove(primitives.core)
        pulsePrimitivesRef.current.delete(id)
      }
    }

    for (const pulse of pulses) {
      const existing = pulsePrimitivesRef.current.get(pulse.id)
      const position = Cesium.Cartesian3.fromDegrees(pulse.lng, pulse.lat)
      const colour   = Cesium.Color.fromCssColorString(PULSE_COLORS[pulse.eventType] ?? '#ffffff')

      if (existing) {
        existing.halo.position = position
        existing.core.position = position
        // Steady-state colour values are restored each frame by the
        // preRender listener; nothing else to refresh on update.
        continue
      }

      const halo = collection.add({
        // id intentionally undefined — pickIdString (globeEngineHelpers:339)
        // only resolves picks for primitives whose id is a string, so
        // pulses cannot steal clicks from sites/signals/assets.
        position,
        pixelSize:    HALO_BASE_PX,
        color:        colour.withAlpha(HALO_BASE_ALPHA * pulse.intensity),
        outlineColor: colour.withAlpha(0),
        outlineWidth: 0,
      })
      const core = collection.add({
        position,
        pixelSize:    CORE_BASE_PX + CORE_RANGE_PX * pulse.intensity,
        color:        colour.withAlpha(CORE_BASE_ALPHA * pulse.intensity),
        outlineColor: Cesium.Color.WHITE.withAlpha(CORE_OUTLINE_BASE_ALPHA * pulse.intensity),
        outlineWidth: 1.5,
      })

      pulsePrimitivesRef.current.set(pulse.id, { halo, core })
    }

    // No-op when there are zero pulses — useful for staying within the
    // <2ms reconcile budget on cold-mount with empty data.
    void prunePrimitiveMap // imported for potential future shared use
  }, [viewerReady, showReplayPulses, pulses, cesiumRef])

  // preRender breath. Registered only while the layer is mounted AND
  // has pulses. Cesium auto-pauses preRender callbacks when the viewer
  // is idle, so this is cheaper than a JS rAF on idle frames.
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return
    if (!showReplayPulses) return
    if (pulses.length === 0) return

    const tick = (_scene: CesiumType.Scene, time: CesiumType.JulianDate) => {
      const timeMs = timeMsFromJulianDate(Cesium, time)
      const breath = breathFraction(timeMs)
      const map = pulsePrimitivesRef.current

      for (const pulse of pulsesRef.current) {
        const primitives = map.get(pulse.id)
        if (!primitives) continue
        const colour = Cesium.Color.fromCssColorString(PULSE_COLORS[pulse.eventType] ?? '#ffffff')

        // Halo radius scales with intensity AND breath; alpha scales with
        // intensity only so the breath visually reads as "size + brightness
        // pulse" rather than a fade in/out the operator could miss.
        primitives.halo.pixelSize = HALO_BASE_PX + HALO_RANGE_PX * pulse.intensity * breath
        primitives.halo.color     = colour.withAlpha(HALO_BASE_ALPHA * pulse.intensity * (0.6 + 0.4 * breath))

        // Core stays steady-sized; only its alpha breathes mildly. The
        // map equivalent doesn't breathe the core at all, but Cesium's
        // single-primitive layering benefits from a small core lift so
        // the whole pulse reads as one breathing unit.
        primitives.core.pixelSize    = CORE_BASE_PX + CORE_RANGE_PX * pulse.intensity
        primitives.core.color        = colour.withAlpha(CORE_BASE_ALPHA * pulse.intensity)
        primitives.core.outlineColor = Cesium.Color.WHITE.withAlpha(CORE_OUTLINE_BASE_ALPHA * pulse.intensity * (0.7 + 0.3 * breath))
      }
    }

    viewer.scene.preRender.addEventListener(tick)

    return () => {
      if (!viewer.isDestroyed()) {
        viewer.scene.preRender.removeEventListener(tick)
      }
    }
  }, [viewerReady, showReplayPulses, pulses.length, viewerRef, cesiumRef])
}
