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
  setEntityPointDisableDepthTestDistance,
  setEntityPointHeightReference,
  setEntityPointOutlineColor,
  setEntityPointOutlineWidth,
  setEntityPosition,
  type CesiumModule,
} from '../../lib/globeEngineHelpers'
import type { TelemetryMap } from '../../lib/telemetry'

// Mirrors the map asset-linked-ring color (#5282ff) from useMapAssetLayers so
// the visual contract is consistent with the map surface.
const ASSET_LINKED_OUTLINE_CSS   = '#5282ff'
const ASSET_LINKED_OUTLINE_WIDTH = 4
const ASSET_DEFAULT_OUTLINE_WIDTH = 2

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
