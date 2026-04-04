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
  setEntityPosition,
  type CesiumModule,
} from '../../lib/globeEngineHelpers'
import type { TelemetryMap } from '../../lib/telemetry'

export interface GlobeAssetEntitiesInput {
  viewerRef:   React.RefObject<CesiumType.Viewer | null>
  cesiumRef:   React.RefObject<CesiumModule | null>
  viewerReady: boolean
  sites:       Site[]
  assets:      Asset[]
  readings:    TelemetryMap
  isReplaying: boolean
  asOf:        string | undefined
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

  return { assetEntitiesRef }
}
