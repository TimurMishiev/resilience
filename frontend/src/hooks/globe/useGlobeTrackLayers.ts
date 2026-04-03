/**
 * useGlobeTrackLayers
 *
 * Manages Cesium polyline entities for vessel tracks and asset trails.
 * Extracted from useGlobeEngine to reduce the main hook's size.
 */

import { useEffect, useRef } from 'react'
import type * as CesiumType from 'cesium'
import type { VesselTrack } from '../../api/vessels'
import {
  setPolylineBooleanProperty,
  setPolylineNumericProperty,
  setPolylinePositions,
  type CesiumModule,
} from '../../lib/globeEngineHelpers'
import { ASSET_STATUS_COLORS, SIGNAL_COLORS } from '../../lib/signalConfig'
import type { AssetTrail } from '../../lib/telemetry'

export interface GlobeTrackLayersInput {
  viewerRef:   React.RefObject<CesiumType.Viewer | null>
  cesiumRef:   React.RefObject<CesiumModule | null>
  viewerReady: boolean

  vesselTracks: VesselTrack[]
  assetTrails:  AssetTrail[]
  showTrails:   boolean
}

export interface GlobeTrackLayersReturn {
  /** Look up a track entity by id string (e.g. "vessel-track", "asset-trail-xxx"). */
  getTrackEntity: (idString: string) => CesiumType.Entity | null
}

export function useGlobeTrackLayers({
  viewerRef,
  cesiumRef,
  viewerReady,
  vesselTracks,
  assetTrails,
  showTrails,
}: GlobeTrackLayersInput): GlobeTrackLayersReturn {
  const vesselTrackEntityRef  = useRef<CesiumType.Entity | null>(null)
  const assetTrailEntitiesRef = useRef<Map<string, CesiumType.Entity>>(new Map())

  // ---------------------------------------------------------------------------
  // Vessel track — single selected-vessel polyline, updated in place
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const existing = vesselTrackEntityRef.current
    if (vesselTracks.length < 2) {
      if (existing) {
        viewer.entities.remove(existing)
        vesselTrackEntityRef.current = null
      }
      return
    }

    const flatCoords = vesselTracks.flatMap(track => [Number(track.lng), Number(track.lat)])
    const positions = Cesium.Cartesian3.fromDegreesArray(flatCoords)
    const material = new Cesium.PolylineDashMaterialProperty({
      color: Cesium.Color.fromCssColorString(SIGNAL_COLORS.vessel_position).withAlpha(0.8),
      dashLength: 18,
    })

    if (existing?.polyline) {
      existing.name = 'Selected vessel track'
      setPolylinePositions(Cesium, existing.polyline, positions)
      existing.polyline.material = material
      setPolylineNumericProperty(Cesium, existing.polyline.width, 2.5, next => { existing.polyline!.width = next })
      setPolylineBooleanProperty(Cesium, existing.polyline.clampToGround, false, next => { existing.polyline!.clampToGround = next })
      return
    }

    vesselTrackEntityRef.current = viewer.entities.add({
      id: 'vessel-track',
      name: 'Selected vessel track',
      polyline: {
        positions: new Cesium.ConstantProperty(positions),
        width: new Cesium.ConstantProperty(2.5),
        material,
        clampToGround: new Cesium.ConstantProperty(false),
      },
    })
  }, [viewerReady, vesselTracks, cesiumRef, viewerRef])

  // ---------------------------------------------------------------------------
  // Asset trails — one polyline per asset, colored by status, replay-only
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const entityMap = assetTrailEntitiesRef.current

    // Build set of current asset IDs to prune stale trails
    const currentIds = new Set(assetTrails.filter(t => t.points.length >= 2).map(t => t.asset_id))

    // Remove stale
    for (const [id, entity] of entityMap) {
      if (!currentIds.has(id)) {
        viewer.entities.remove(entity)
        entityMap.delete(id)
      }
    }

    for (const trail of assetTrails) {
      if (trail.points.length < 2) continue

      const flatCoords = trail.points.flatMap(p => [p.lng, p.lat])
      const positions = Cesium.Cartesian3.fromDegreesArray(flatCoords)
      const cssColor = ASSET_STATUS_COLORS[trail.status] ?? ASSET_STATUS_COLORS['offline']
      const material = new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.15,
        color: Cesium.Color.fromCssColorString(cssColor).withAlpha(0.7),
      })

      const existing = entityMap.get(trail.asset_id)
      if (existing?.polyline) {
        setPolylinePositions(Cesium, existing.polyline, positions)
        existing.polyline.material = material
        continue
      }

      const entity = viewer.entities.add({
        id: `asset-trail-${trail.asset_id}`,
        name: `${trail.name} trail`,
        polyline: {
          positions: new Cesium.ConstantProperty(positions),
          width: new Cesium.ConstantProperty(2),
          material,
          clampToGround: new Cesium.ConstantProperty(false),
        },
      })
      entityMap.set(trail.asset_id, entity)
    }
  }, [viewerReady, assetTrails, cesiumRef, viewerRef])

  // ---------------------------------------------------------------------------
  // Asset trail visibility toggle
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const entityMap = assetTrailEntitiesRef.current
    for (const entity of entityMap.values()) {
      entity.show = showTrails
    }
  }, [showTrails])

  // ---------------------------------------------------------------------------
  // Entity lookup for projection / instrumentation
  // ---------------------------------------------------------------------------
  function getTrackEntity(idString: string): CesiumType.Entity | null {
    if (idString === 'vessel-track') return vesselTrackEntityRef.current
    return assetTrailEntitiesRef.current.get(idString.replace('asset-trail-', '')) ?? null
  }

  return { getTrackEntity }
}
