/**
 * useGlobeAssetEntities
 *
 * Manages Cesium Entity instances for assets — entity creation from home-site
 * seed positions and telemetry-driven position updates. Extracted from useGlobeEngine.
 */

import { useEffect, useRef } from 'react'
import type * as CesiumType from 'cesium'
import type { Site, Asset } from '../../api/types'
import { assetDisplayPosition, assetSeedPosition } from '../../lib/assetPresentation'
import {
  pruneEntityMap,
  setEntityLabelDisableDepthTestDistance,
  setEntityLabelHeightReference,
  setEntityLabelText,
  setEntityPointColor,
  setEntityPointDisableDepthTestDistance,
  setEntityPointHeightReference,
  setEntityPointOutlineColor,
  setEntityPointOutlineWidth,
  setEntityPosition,
  type CesiumModule,
} from '../../lib/globeEngineHelpers'
import type { TelemetryMap } from '../../lib/telemetry'
import {
  ASSET_FRESHNESS_THRESHOLDS,
  deriveFreshness,
  type FreshnessState,
} from '../../lib/freshness'

// Mirrors the map asset-linked-ring color (#5282ff) from useMapAssetLayers so
// the visual contract is consistent with the map surface.
const ASSET_LINKED_OUTLINE_CSS   = '#5282ff'
const ASSET_LINKED_OUTLINE_WIDTH = 4
const ASSET_DEFAULT_OUTLINE_WIDTH = 2

// Freshness → fill alpha. Mirrors useMapAssetLayers' circle-opacity table so
// the two surfaces render the same asset in the same visual "vividness"
// given the same reference clock. Freshness modulates the point fill only;
// outline state (linked/evidence/default) is owned by the prior slice's
// outline effect and should remain untouched so the two visual channels
// don't fight each other.
const ASSET_FILL_ALPHA_BY_FRESHNESS: Record<FreshnessState, number> = {
  fresh:       0.94,
  aging:       0.72,
  stale:       0.46,
  unavailable: 0.32,
}

export interface GlobeAssetEntitiesInput {
  viewerRef:   React.RefObject<CesiumType.Viewer | null>
  cesiumRef:   React.RefObject<CesiumModule | null>
  viewerReady: boolean
  sites:       Site[]
  assets:      Asset[]
  readings:    TelemetryMap
  isReplaying: boolean
  asOf:        string | undefined
  /**
   * When a site is selected, assets whose home_site_id matches this id get the
   * linked-highlight outline. Null clears the highlight. Semantics identical
   * to useMapAssetLayers#linkedSiteId.
   */
  linkedSiteId: string | null
  /**
   * Replay-aware clock. When set, each asset's point-fill alpha is modulated
   * by deriveFreshness(last_reported_at, referenceTimeMs). Live or replay is
   * decided at the page level — this hook just consumes the clock it is given.
   */
  referenceTimeMs: number
}

export interface GlobeAssetEntitiesReturn {
  assetEntitiesRef: React.RefObject<Map<string, CesiumType.Entity>>
}

export function useGlobeAssetEntities({
  viewerRef,
  cesiumRef,
  viewerReady,
  sites,
  assets,
  readings,
  isReplaying,
  asOf,
  linkedSiteId,
  referenceTimeMs,
}: GlobeAssetEntitiesInput): GlobeAssetEntitiesReturn {
  const assetEntitiesRef = useRef<Map<string, CesiumType.Entity>>(new Map())

  // Entity creation / update
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const currentIds = new Set(assets.map(a => `asset-${a.id}`))
    pruneEntityMap(viewer, assetEntitiesRef.current, currentIds)

    if (assets.length === 0) return

    for (const asset of assets) {
      const key      = `asset-${asset.id}`
      const existing = assetEntitiesRef.current.get(key)
      if (existing) {
        existing.name = asset.name
        setEntityLabelText(Cesium, existing, asset.name)
        setEntityPointHeightReference(Cesium, existing, Cesium.HeightReference.CLAMP_TO_GROUND)
        setEntityPointDisableDepthTestDistance(Cesium, existing, 0)
        setEntityLabelHeightReference(Cesium, existing, Cesium.HeightReference.CLAMP_TO_GROUND)
        setEntityLabelDisableDepthTestDistance(Cesium, existing, 0)
        continue
      }

      const homeSite = sites.find(s => s.id === asset.home_site_id)
      const { lat, lng } = assetSeedPosition(asset.id, homeSite)

      const entity = viewer.entities.add({
        id:       key,
        name:     asset.name,
        position: Cesium.Cartesian3.fromDegrees(lng, lat),
        point: {
          pixelSize:               10,
          color:                   Cesium.Color.CYAN.withAlpha(0.95),
          outlineColor:            Cesium.Color.WHITE.withAlpha(0.7),
          outlineWidth:            2,
          disableDepthTestDistance: 0,
          heightReference:         Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text:                    asset.name,
          font:                    '500 10px "system-ui", sans-serif',
          fillColor:               Cesium.Color.CYAN,
          outlineColor:            Cesium.Color.BLACK,
          outlineWidth:            2,
          style:                   Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:             new Cesium.Cartesian2(0, -16),
          disableDepthTestDistance: 0,
          heightReference:         Cesium.HeightReference.CLAMP_TO_GROUND,
          translucencyByDistance:  new Cesium.NearFarScalar(5e5, 1.0, 3e6, 0.0),
        },
      })
      assetEntitiesRef.current.set(key, entity)
    }
  }, [viewerReady, assets, sites, cesiumRef, viewerRef])

  // Position updates — driven by telemetry tick
  useEffect(() => {
    const Cesium = cesiumRef.current
    if (!viewerReady || !viewerRef.current || !Cesium) return
    for (const asset of assets) {
      const entity = assetEntitiesRef.current.get(`asset-${asset.id}`)
      if (!entity) continue
      const { lat, lng } = assetDisplayPosition(asset, sites, readings, { lat: 0, lng: 0 }, { allowHistorical: isReplaying })
      setEntityPosition(Cesium, entity, lng, lat)
    }
  }, [viewerReady, assets, readings, sites, isReplaying, asOf, cesiumRef, viewerRef])

  // Freshness-driven fill alpha. Each asset's point color alpha reflects how
  // stale the last telemetry update is relative to referenceTimeMs. Mirrors
  // the map's circle-opacity table (useMapAssetLayers:62-69) so cross-surface
  // rendering is consistent. Runs on every [assets, referenceTimeMs] change
  // so replay scrubbing + live tick both re-apply correctly; freshly-created
  // entities pick up the correct alpha on first render.
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    for (const asset of assets) {
      const entity = assetEntitiesRef.current.get(`asset-${asset.id}`)
      if (!entity) continue

      const timestamp  = asset.last_reported_at ?? asset.updated_at
      const updatedAtMs = Date.parse(timestamp)
      const freshness: FreshnessState = Number.isFinite(updatedAtMs)
        ? deriveFreshness(updatedAtMs, referenceTimeMs, ASSET_FRESHNESS_THRESHOLDS)
        : 'unavailable'

      const alpha = ASSET_FILL_ALPHA_BY_FRESHNESS[freshness]
      setEntityPointColor(Cesium, entity, Cesium.Color.CYAN.withAlpha(alpha))
    }
  }, [viewerReady, assets, referenceTimeMs, cesiumRef, viewerRef])

  // Linked-highlight outline — blue ring on assets whose home_site_id matches
  // the currently selected site. Re-runs on linkedSiteId AND assets change so
  // freshly-created entities inherit the correct highlight state on first render.
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const linkedColor  = Cesium.Color.fromCssColorString(ASSET_LINKED_OUTLINE_CSS).withAlpha(0.95)
    const defaultColor = Cesium.Color.WHITE.withAlpha(0.7)

    for (const asset of assets) {
      const entity = assetEntitiesRef.current.get(`asset-${asset.id}`)
      if (!entity) continue
      const isLinked = linkedSiteId != null && asset.home_site_id === linkedSiteId
      setEntityPointOutlineColor(Cesium, entity, isLinked ? linkedColor : defaultColor)
      setEntityPointOutlineWidth(Cesium, entity, isLinked ? ASSET_LINKED_OUTLINE_WIDTH : ASSET_DEFAULT_OUTLINE_WIDTH)
    }
  }, [viewerReady, assets, linkedSiteId, cesiumRef, viewerRef])

  return { assetEntitiesRef }
}
