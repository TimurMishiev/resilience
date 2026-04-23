/**
 * useGlobeSiteEntities
 *
 * Manages Cesium Entity instances for sites — incremental add/update/remove
 * based on the current site + task data. Extracted from useGlobeEngine.
 */

import { useEffect, useRef } from 'react'
import type * as CesiumType from 'cesium'
import type { Site, Task } from '../../api/types'
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
  siteColor,
  type CesiumModule,
} from '../../lib/globeEngineHelpers'

// Mirrors the map site-linked-ring color (#5282ff) from useMapSiteLayers so the
// visual contract is consistent across the two operator surfaces.
const SITE_LINKED_OUTLINE_CSS  = '#5282ff'
const SITE_LINKED_OUTLINE_WIDTH = 4
const SITE_DEFAULT_OUTLINE_WIDTH = 2

export interface GlobeSiteEntitiesInput {
  viewerRef:   React.RefObject<CesiumType.Viewer | null>
  cesiumRef:   React.RefObject<CesiumModule | null>
  viewerReady: boolean
  sites:       Site[]
  tasksBySite: Record<string, Task[]>
  /**
   * ID of the site that should be linked-highlighted — typically the home_site
   * of the currently selected asset. Null clears the highlight.
   */
  linkedSiteId: string | null
}

export interface GlobeSiteEntitiesReturn {
  siteEntitiesRef: React.RefObject<Map<string, CesiumType.Entity>>
}

export function useGlobeSiteEntities({
  viewerRef,
  cesiumRef,
  viewerReady,
  sites,
  tasksBySite,
  linkedSiteId,
}: GlobeSiteEntitiesInput): GlobeSiteEntitiesReturn {
  const siteEntitiesRef = useRef<Map<string, CesiumType.Entity>>(new Map())

  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const currentIds = new Set(sites.map(s => `site-${s.id}`))
    pruneEntityMap(viewer, siteEntitiesRef.current, currentIds)

    if (sites.length === 0) return

    for (const site of sites) {
      const siteTasks = tasksBySite[site.id] ?? []
      const color     = siteColor(Cesium, siteTasks, site.status)
      const key       = `site-${site.id}`

      const existing = siteEntitiesRef.current.get(key)
      if (existing) {
        existing.name = site.name
        setEntityPosition(Cesium, existing, Number(site.longitude), Number(site.latitude))
        setEntityPointColor(Cesium, existing, color)
        setEntityPointHeightReference(Cesium, existing, Cesium.HeightReference.CLAMP_TO_GROUND)
        setEntityPointDisableDepthTestDistance(Cesium, existing, 0)
        setEntityLabelText(Cesium, existing, site.name)
        setEntityLabelHeightReference(Cesium, existing, Cesium.HeightReference.CLAMP_TO_GROUND)
        setEntityLabelDisableDepthTestDistance(Cesium, existing, 0)
        continue
      }

      const entity = viewer.entities.add({
        id:       key,
        name:     site.name,
        position: Cesium.Cartesian3.fromDegrees(Number(site.longitude), Number(site.latitude)),
        point: {
          pixelSize:               16,
          color,
          outlineColor:            Cesium.Color.WHITE.withAlpha(0.8),
          outlineWidth:            2,
          disableDepthTestDistance: 0,
          heightReference:         Cesium.HeightReference.CLAMP_TO_GROUND,
          scaleByDistance:         new Cesium.NearFarScalar(1e5, 1.5, 8e6, 0.8),
        },
        label: {
          text:                    site.name,
          font:                    '600 12px "system-ui", sans-serif',
          fillColor:               Cesium.Color.WHITE,
          outlineColor:            Cesium.Color.BLACK,
          outlineWidth:            2,
          style:                   Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:             new Cesium.Cartesian2(0, -22),
          disableDepthTestDistance: 0,
          heightReference:         Cesium.HeightReference.CLAMP_TO_GROUND,
          translucencyByDistance:  new Cesium.NearFarScalar(1e6, 1.0, 8e6, 0.0),
        },
      })
      siteEntitiesRef.current.set(key, entity)
    }
  }, [viewerReady, sites, tasksBySite, cesiumRef, viewerRef])

  // Linked-highlight outline — blue ring on the site that is the home_site of
  // the currently selected asset. Re-runs on linkedSiteId change AND on sites
  // change, so freshly-added entities pick up the correct outline state.
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const linkedColor  = Cesium.Color.fromCssColorString(SITE_LINKED_OUTLINE_CSS).withAlpha(0.95)
    const defaultColor = Cesium.Color.WHITE.withAlpha(0.8)

    for (const [key, entity] of siteEntitiesRef.current.entries()) {
      const id = key.replace(/^site-/, '')
      const isLinked = linkedSiteId != null && id === linkedSiteId
      setEntityPointOutlineColor(Cesium, entity, isLinked ? linkedColor : defaultColor)
      setEntityPointOutlineWidth(Cesium, entity, isLinked ? SITE_LINKED_OUTLINE_WIDTH : SITE_DEFAULT_OUTLINE_WIDTH)
    }
  }, [viewerReady, sites, linkedSiteId, cesiumRef, viewerRef])

  return { siteEntitiesRef }
}
