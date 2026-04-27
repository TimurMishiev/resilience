/**
 * useGlobeConfidenceHaloPrimitives — Tranche 6-D-globe.
 *
 * Cesium parity for the confidence halo layer that 6-D-map shipped on
 * `/map`. Same data feed (useActiveSiteConfidence raw summaries +
 * bucketReplayAsOf), same site-level reduction (server-side
 * `site_id -> max(active match confidence)`), same replay-only
 * contract — the visible difference is just that this surface
 * renders halos on the globe instead of the map.
 *
 * Shape (locked after recon + pressure-test):
 *   - dedicated `PointPrimitiveCollection` mounted only when
 *     `viewerReady && isReplaying`; live mode does not register
 *     the collection at all
 *   - one PointPrimitive per active site (NOT halo+core dual; this
 *     is an affordance, not a pulse — single primitive)
 *   - `id: undefined` so [pickIdString](../../lib/globeEngineHelpers.ts)
 *     filters it out and clicks pass through to sites/signals
 *   - fixed pixel size 22 (perceptual parity with map's 14px halo
 *     around a 9px site, transposed onto the globe's 16px site
 *     primitive — site + ~5px)
 *   - amber `#f59f00`; alpha = 0.25 + 0.55 * confidence (matches
 *     the map's opacity ramp expression exactly)
 *   - reconcile/update/prune like useGlobeSignalPrimitives — no
 *     CallbackProperty, no preRender listener, no per-frame work.
 *     Confidence is static per render
 *   - no `distanceDisplayCondition`: globe site primitives at
 *     useGlobeSiteEntities.ts:104-116 don't use one (only
 *     `scaleByDistance`); halo follows site convention
 *
 * Drops summary rows whose site_id is absent from the current
 * `sites` dataset (surface-specific concern; the data hook stays
 * raw so 6-D-map and 6-D-globe share its output unchanged).
 */

import { useEffect, useRef } from 'react'
import type * as CesiumType from 'cesium'
import type { CesiumModule } from '../../lib/globeEngineHelpers'
import type { Site } from '../../api/types'
import type { ActiveSiteConfidence } from '../../api/signal_rule_matches'

export interface GlobeConfidenceHaloPrimitivesInput {
  viewerRef:    React.RefObject<CesiumType.Viewer | null>
  cesiumRef:    React.RefObject<CesiumModule | null>
  viewerReady:  boolean
  sites:        readonly Site[]
  summaries:    readonly ActiveSiteConfidence[]
  isReplaying:  boolean
}

export const HALO_PIXEL_SIZE        = 22
export const HALO_BASE_COLOR        = '#f59f00'
export const HALO_OPACITY_FLOOR     = 0.25
export const HALO_OPACITY_RANGE     = 0.55
export const HALO_OUTLINE_FLOOR     = 0.40
export const HALO_OUTLINE_RANGE     = 0.55
export const HALO_OUTLINE_WIDTH     = 1.5

export function useGlobeConfidenceHaloPrimitives({
  viewerRef,
  cesiumRef,
  viewerReady,
  sites,
  summaries,
  isReplaying,
}: GlobeConfidenceHaloPrimitivesInput): void {
  const collectionRef     = useRef<CesiumType.PointPrimitiveCollection | null>(null)
  const haloPrimitivesRef = useRef<Map<string, CesiumType.PointPrimitive>>(new Map())

  // Collection lifecycle. Mounted only while replaying; teardown on
  // replay exit removes the collection AND clears the primitive map
  // so a re-mount starts clean.
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return
    if (!isReplaying) return

    const collection = new Cesium.PointPrimitiveCollection()
    viewer.scene.primitives.add(collection)
    collectionRef.current = collection
    const primitiveMap = haloPrimitivesRef.current

    return () => {
      // The viewer's destroy() teardown already destroys child
      // primitives; guard so we don't double-remove.
      if (!viewer.isDestroyed()) {
        viewer.scene.primitives.remove(collection)
      }
      primitiveMap.clear()
      collectionRef.current = null
    }
  }, [viewerReady, isReplaying, viewerRef, cesiumRef])

  // Reconcile/update/prune. Summary churn is bounded (~5–20 sites
  // in production); shape mirrors useGlobeSignalPrimitives.
  useEffect(() => {
    const Cesium     = cesiumRef.current
    const collection = collectionRef.current
    if (!viewerReady || !Cesium || !collection) return
    if (!isReplaying) {
      // Lifecycle effect already tears the collection down; clear
      // the map so a re-mount starts from zero.
      haloPrimitivesRef.current.clear()
      return
    }

    const siteById = new Map<string, Site>()
    for (const site of sites) siteById.set(site.id, site)

    const currentIds = new Set<string>()
    for (const summary of summaries) {
      // Drop missing-site rows here — surface-specific concern.
      // The raw data hook intentionally does not filter these so
      // the map and globe surfaces share its output unchanged.
      if (!siteById.has(summary.site_id)) continue
      currentIds.add(summary.site_id)
    }

    // Prune halos for sites no longer in the active summary set.
    for (const [siteId, primitive] of haloPrimitivesRef.current) {
      if (!currentIds.has(siteId)) {
        collection.remove(primitive)
        haloPrimitivesRef.current.delete(siteId)
      }
    }

    for (const summary of summaries) {
      const site = siteById.get(summary.site_id)
      if (!site) continue

      const confidence = clampConfidence(summary.confidence)
      const alpha   = HALO_OPACITY_FLOOR + HALO_OPACITY_RANGE * confidence
      const outline = HALO_OUTLINE_FLOOR + HALO_OUTLINE_RANGE * confidence
      const baseColor = Cesium.Color.fromCssColorString(HALO_BASE_COLOR)
      const fillColor    = baseColor.withAlpha(alpha)
      const outlineColor = baseColor.withAlpha(outline)
      const position = Cesium.Cartesian3.fromDegrees(Number(site.longitude), Number(site.latitude))

      const existing = haloPrimitivesRef.current.get(summary.site_id)
      if (existing) {
        existing.position     = position
        existing.color        = fillColor
        existing.outlineColor = outlineColor
        existing.pixelSize    = HALO_PIXEL_SIZE
        continue
      }

      const primitive = collection.add({
        // id intentionally undefined — pickIdString filters
        // non-string ids so halos cannot steal click picks from
        // sites/signals/assets.
        position,
        pixelSize:    HALO_PIXEL_SIZE,
        color:        fillColor,
        outlineColor,
        outlineWidth: HALO_OUTLINE_WIDTH,
      })
      haloPrimitivesRef.current.set(summary.site_id, primitive)
    }
  }, [viewerReady, isReplaying, sites, summaries, cesiumRef])
}

function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}
