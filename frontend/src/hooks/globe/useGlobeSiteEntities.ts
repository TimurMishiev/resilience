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

// Outline palette mirrors the map site ring layers so the two operator
// surfaces share a visual contract:
//   linked    (#5282ff, width 4) — home site of the selected asset
//   evidence  (#f5a623, width 3) — sites tied to the selected signal via
//                                  rule matches (useEvidenceLinkedIds)
//   default   (white,   width 2)
// Precedence: linked wins over evidence wins over default. A site that is
// both evidence-linked and the selected asset's home site shows the linked
// ring, matching the map's layer-order semantics where site-linked-ring is
// added after site-evidence-ring.
const SITE_LINKED_OUTLINE_CSS   = '#5282ff'
const SITE_LINKED_OUTLINE_WIDTH = 4
const SITE_EVIDENCE_OUTLINE_CSS   = '#f5a623'
const SITE_EVIDENCE_OUTLINE_WIDTH = 3
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
  /**
   * Sites linked to the currently selected signal via rule matches. Parity
   * with map's `site-evidence-ring` at useMapSiteLayers:140-145. Empty array
   * when nothing is selected or no rule-match evidence exists.
   */
  evidenceSiteIds: string[]
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
  evidenceSiteIds,
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

  // Three-state outline precedence — linked > evidence > default. Re-runs on
  // any of linkedSiteId / evidenceSiteIds / sites change, so freshly-added
  // entities pick up the correct outline state without a second effect pass.
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const linkedColor   = Cesium.Color.fromCssColorString(SITE_LINKED_OUTLINE_CSS).withAlpha(0.95)
    const evidenceColor = Cesium.Color.fromCssColorString(SITE_EVIDENCE_OUTLINE_CSS).withAlpha(0.9)
    const defaultColor  = Cesium.Color.WHITE.withAlpha(0.8)
    const evidenceSet   = new Set(evidenceSiteIds)

    for (const site of sites) {
      const entity = siteEntitiesRef.current.get(`site-${site.id}`)
      if (!entity) continue

      const isLinked   = linkedSiteId != null && site.id === linkedSiteId
      const isEvidence = !isLinked && evidenceSet.has(site.id)

      if (isLinked) {
        setEntityPointOutlineColor(Cesium, entity, linkedColor)
        setEntityPointOutlineWidth(Cesium, entity, SITE_LINKED_OUTLINE_WIDTH)
      } else if (isEvidence) {
        setEntityPointOutlineColor(Cesium, entity, evidenceColor)
        setEntityPointOutlineWidth(Cesium, entity, SITE_EVIDENCE_OUTLINE_WIDTH)
      } else {
        setEntityPointOutlineColor(Cesium, entity, defaultColor)
        setEntityPointOutlineWidth(Cesium, entity, SITE_DEFAULT_OUTLINE_WIDTH)
      }
    }
  }, [viewerReady, sites, linkedSiteId, evidenceSiteIds, cesiumRef, viewerRef])

  return { siteEntitiesRef }
}
