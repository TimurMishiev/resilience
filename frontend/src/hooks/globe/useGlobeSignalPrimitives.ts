/**
 * useGlobeSignalPrimitives
 *
 * Manages Cesium PointPrimitiveCollection for high-volume signal rendering.
 * Uses primitives instead of entities for performance at scale.
 * Extracted from useGlobeEngine.
 */

import { useEffect, useMemo, useRef } from 'react'
import type * as CesiumType from 'cesium'
import type { Signal } from '../../api/types'
import { haversineKm } from '../../lib/coverage'
import {
  FOCUSED_SIGNAL_RADIUS_KM,
  prunePrimitiveMap,
  SIGNAL_CLOSE_VIEW_HEIGHT_M,
  type CesiumModule,
} from '../../lib/globeEngineHelpers'
import { nowMs, recordPerfEvent } from '../../lib/perfInstrumentation'
import { SIGNAL_COLORS } from '../../lib/signalConfig'

// Mirrors the map signal-evidence-ring color from useMapSignalLayers so
// evidence-linked signals look the same across surfaces. Two-state logic
// (evidence | default); if a third outline state ever lands here, promote
// this to a data-driven table (see prior slice's precedence rule).
const SIGNAL_EVIDENCE_OUTLINE_CSS = '#f5a623'
const SIGNAL_EVIDENCE_OUTLINE_ALPHA = 0.9
const SIGNAL_DEFAULT_OUTLINE_ALPHA  = 0.35

export interface GlobeSignalPrimitivesInput {
  viewerRef:   React.RefObject<CesiumType.Viewer | null>
  cesiumRef:   React.RefObject<CesiumModule | null>
  viewerReady: boolean
  signals:     Signal[]
  showSignals: boolean
  selectedSignalId:  string | null
  signalFocusCenter: { lat: number; lng: number } | null
  signalCollectionRef: React.RefObject<CesiumType.PointPrimitiveCollection | null>
  /**
   * Signals linked to the currently selected site via rule matches. Populated
   * by useEvidenceLinkedIds; empty otherwise. Parity with map's
   * `signal-evidence-ring` at useMapSignalLayers:159-173.
   */
  evidenceSignalIds: string[]
}

export interface GlobeSignalPrimitivesReturn {
  signalPrimitivesRef: React.RefObject<Map<string, CesiumType.PointPrimitive>>
  /** The signal subset currently visible (after focus-radius filtering). */
  visibleSignals: Signal[]
}

export function useGlobeSignalPrimitives({
  viewerRef,
  cesiumRef,
  viewerReady,
  signals,
  showSignals,
  selectedSignalId,
  signalFocusCenter,
  signalCollectionRef,
  evidenceSignalIds,
}: GlobeSignalPrimitivesInput): GlobeSignalPrimitivesReturn {
  const signalPrimitivesRef = useRef<Map<string, CesiumType.PointPrimitive>>(new Map())
  const previousVisibleSignalCountRef = useRef(0)
  const previousSignalFocusModeRef = useRef<'global' | 'focused'>('global')
  const previousShowSignalsRef = useRef(showSignals)

  const visibleSignals = useMemo(() => {
    if (!signalFocusCenter) return signals
    return signals.filter(signal =>
      signal.id === selectedSignalId ||
      haversineKm(signalFocusCenter.lat, signalFocusCenter.lng, Number(signal.lat), Number(signal.lng)) <= FOCUSED_SIGNAL_RADIUS_KM,
    )
  }, [selectedSignalId, signalFocusCenter, signals])

  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    const collection = signalCollectionRef.current
    if (!viewerReady || !viewer || !Cesium || !collection) return

    const startedAt = nowMs()
    const previousShowSignals = previousShowSignalsRef.current
    const previousVisibleCount = previousVisibleSignalCountRef.current
    const previousFocusMode = previousSignalFocusModeRef.current
    const nextFocusMode: 'global' | 'focused' = signalFocusCenter ? 'focused' : 'global'

    collection.show = showSignals

    if (!showSignals) {
      recordPerfEvent('globe.signal_visibility', {
        action: previousShowSignals ? 'hide' : 'steady-hidden',
        previousVisibleCount,
        nextVisibleCount: 0,
        collectionCount: signalPrimitivesRef.current.size,
      }, nowMs() - startedAt)
      previousShowSignalsRef.current = showSignals
      previousVisibleSignalCountRef.current = 0
      previousSignalFocusModeRef.current = nextFocusMode
      return
    }

    const currentIds = new Set(visibleSignals.map(s => `signal-${s.id}`))
    const removedCount = prunePrimitiveMap(collection, signalPrimitivesRef.current, currentIds)
    let updatedCount = 0
    let addedCount = 0

    const distanceDisplayCondition = new Cesium.DistanceDisplayCondition(SIGNAL_CLOSE_VIEW_HEIGHT_M, Number.MAX_VALUE)

    for (const signal of visibleSignals) {
      const key      = `signal-${signal.id}`
      const existing = signalPrimitivesRef.current.get(key)
      const position = Cesium.Cartesian3.fromDegrees(Number(signal.lng), Number(signal.lat))

      if (existing) {
        existing.position = position
        existing.disableDepthTestDistance = 0
        existing.distanceDisplayCondition = distanceDisplayCondition
        updatedCount += 1
        continue
      }

      const color = Cesium.Color.fromCssColorString(SIGNAL_COLORS[signal.signal_type] ?? '#ffffff')
      const primitive = collection.add({
        id:            key,
        position,
        pixelSize:     8,
        color:         color.withAlpha(0.95),
        outlineColor:  color.withAlpha(0.35),
        outlineWidth:  3,
        disableDepthTestDistance: 0,
        distanceDisplayCondition,
      })
      signalPrimitivesRef.current.set(key, primitive)
      addedCount += 1
    }

    const transition =
      previousFocusMode === nextFocusMode
        ? (previousShowSignals ? 'steady' : 'show')
        : `${previousFocusMode}_to_${nextFocusMode}`

    recordPerfEvent('globe.signal_reconcile', {
      transition,
      previousVisibleCount,
      nextVisibleCount: visibleSignals.length,
      addedCount,
      updatedCount,
      removedCount,
      showSignals,
      selectedSignalId,
      focusedSignalCountDelta: visibleSignals.length - previousVisibleCount,
    }, nowMs() - startedAt)

    previousShowSignalsRef.current = showSignals
    previousVisibleSignalCountRef.current = visibleSignals.length
    previousSignalFocusModeRef.current = nextFocusMode
  }, [viewerReady, selectedSignalId, showSignals, signalFocusCenter, visibleSignals, cesiumRef, viewerRef, signalCollectionRef])

  // Evidence-linked outline. Signals tied to the selected site via rule
  // matches render an amber outline (#f5a623, alpha 0.9). Non-linked signals
  // revert to the default per-signal-type outline (base color @ alpha 0.35).
  // Re-runs on visibleSignals AND evidenceSignalIds change, so freshly-added
  // primitives pick up the correct outline on first render.
  //
  // Colors are precomputed once per effect run. SIGNAL_COLORS has ~8 entries,
  // so the default-outline map is O(1) relative to signal count. A per-signal
  // `fromCssColorString().withAlpha()` call inside the loop would allocate
  // O(N) Color objects per render — cheap at typical scale but the right
  // idiom either way. Mirrors the `evidenceColor` hoist above.
  useEffect(() => {
    const Cesium = cesiumRef.current
    if (!viewerReady || !Cesium) return

    const evidenceSet   = new Set(evidenceSignalIds)
    const evidenceColor = Cesium.Color.fromCssColorString(SIGNAL_EVIDENCE_OUTLINE_CSS).withAlpha(SIGNAL_EVIDENCE_OUTLINE_ALPHA)

    const defaultOutlineByType = new Map<string, CesiumType.Color>()
    for (const [signalType, css] of Object.entries(SIGNAL_COLORS)) {
      defaultOutlineByType.set(
        signalType,
        Cesium.Color.fromCssColorString(css).withAlpha(SIGNAL_DEFAULT_OUTLINE_ALPHA),
      )
    }
    const fallbackOutline = Cesium.Color.fromCssColorString('#ffffff').withAlpha(SIGNAL_DEFAULT_OUTLINE_ALPHA)

    for (const signal of visibleSignals) {
      const primitive = signalPrimitivesRef.current.get(`signal-${signal.id}`)
      if (!primitive) continue

      primitive.outlineColor = evidenceSet.has(signal.id)
        ? evidenceColor
        : (defaultOutlineByType.get(signal.signal_type) ?? fallbackOutline)
    }
  }, [viewerReady, visibleSignals, evidenceSignalIds, cesiumRef])

  return { signalPrimitivesRef, visibleSignals }
}
