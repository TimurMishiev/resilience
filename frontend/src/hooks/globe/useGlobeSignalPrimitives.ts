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

export interface GlobeSignalPrimitivesInput {
  viewerRef:   React.RefObject<CesiumType.Viewer | null>
  cesiumRef:   React.RefObject<CesiumModule | null>
  viewerReady: boolean
  signals:     Signal[]
  showSignals: boolean
  selectedSignalId:  string | null
  signalFocusCenter: { lat: number; lng: number } | null
  signalCollectionRef: React.RefObject<CesiumType.PointPrimitiveCollection | null>
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

  return { signalPrimitivesRef, visibleSignals }
}
