import type * as CesiumType from 'cesium'
import type { Asset, Signal, Site, Task } from '../api/types'

export type CesiumModule = typeof import('cesium')

export const SIGNAL_CLOSE_VIEW_HEIGHT_M = 2_000_000
export const FOCUSED_SIGNAL_RADIUS_KM = 2_000
const HEATMAP_MIN_RADIUS_KM = 90
const HEATMAP_MAX_RADIUS_KM = 260

export const COVERAGE_COLOR_BY_STATUS: Record<Asset['status'], string> = {
  available: '#3ddc84',
  assigned: '#5282ff',
  degraded: '#ffb366',
  offline: '#8f99a8',
}

export const CHOKEPOINT_COLOR_BY_STATUS: Record<string, string> = {
  monitor: '#ffd43b',
  constrained: '#ff922b',
  contested: '#fa5252',
  closed: '#868e96',
}

export function siteColor(Cesium: CesiumModule, tasks: Task[], siteStatus: Site['status']): CesiumType.Color {
  if (siteStatus === 'inactive') return Cesium.Color.GRAY
  if (tasks.length === 0) return Cesium.Color.DODGERBLUE
  if (tasks.some(t => t.workflow_status === 'blocked')) return Cesium.Color.RED
  if (tasks.every(t => t.workflow_status === 'resolved')) return Cesium.Color.LIMEGREEN
  if (tasks.some(t => t.workflow_status === 'in_progress')) return Cesium.Color.DODGERBLUE
  return Cesium.Color.ORANGE
}

export function setEntityPosition(Cesium: CesiumModule, entity: CesiumType.Entity, lng: number, lat: number) {
  const position = Cesium.Cartesian3.fromDegrees(lng, lat)
  if (entity.position instanceof Cesium.ConstantPositionProperty) {
    entity.position.setValue(position)
    return
  }
  entity.position = new Cesium.ConstantPositionProperty(position)
}

export function setEntityLabelText(Cesium: CesiumModule, entity: CesiumType.Entity, text: string) {
  if (!entity.label) return
  if (entity.label.text instanceof Cesium.ConstantProperty) {
    entity.label.text.setValue(text)
    return
  }
  entity.label.text = new Cesium.ConstantProperty(text)
}

export function setEntityPointColor(Cesium: CesiumModule, entity: CesiumType.Entity, color: CesiumType.Color) {
  if (!entity.point) return
  if (entity.point.color instanceof Cesium.ConstantProperty) {
    entity.point.color.setValue(color)
    return
  }
  entity.point.color = new Cesium.ConstantProperty(color)
}

export function setConstantPropertyValue<T>(
  Cesium: CesiumModule,
  property: CesiumType.Property | undefined,
  value: T,
  assign: (next: CesiumType.ConstantProperty) => void,
) {
  if (property instanceof Cesium.ConstantProperty) {
    property.setValue(value)
    return
  }
  assign(new Cesium.ConstantProperty(value))
}

export function setEntityPointHeightReference(
  Cesium: CesiumModule,
  entity: CesiumType.Entity,
  heightReference: CesiumType.HeightReference,
) {
  if (!entity.point) return
  setConstantPropertyValue(Cesium, entity.point.heightReference, heightReference, next => {
    entity.point!.heightReference = next
  })
}

export function setEntityPointDisableDepthTestDistance(
  Cesium: CesiumModule,
  entity: CesiumType.Entity,
  distance: number,
) {
  if (!entity.point) return
  setConstantPropertyValue(Cesium, entity.point.disableDepthTestDistance, distance, next => {
    entity.point!.disableDepthTestDistance = next
  })
}

export function setEntityLabelHeightReference(
  Cesium: CesiumModule,
  entity: CesiumType.Entity,
  heightReference: CesiumType.HeightReference,
) {
  if (!entity.label) return
  setConstantPropertyValue(Cesium, entity.label.heightReference, heightReference, next => {
    entity.label!.heightReference = next
  })
}

export function setEntityLabelDisableDepthTestDistance(
  Cesium: CesiumModule,
  entity: CesiumType.Entity,
  distance: number,
) {
  if (!entity.label) return
  setConstantPropertyValue(Cesium, entity.label.disableDepthTestDistance, distance, next => {
    entity.label!.disableDepthTestDistance = next
  })
}

export function setPolygonHierarchy(Cesium: CesiumModule, graphics: CesiumType.PolygonGraphics, positions: CesiumType.Cartesian3[]) {
  const hierarchy = new Cesium.PolygonHierarchy(positions)
  if (graphics.hierarchy instanceof Cesium.ConstantProperty) {
    graphics.hierarchy.setValue(hierarchy)
    return
  }
  graphics.hierarchy = new Cesium.ConstantProperty(hierarchy)
}

export function setPolygonOutlineColor(Cesium: CesiumModule, graphics: CesiumType.PolygonGraphics, color: CesiumType.Color) {
  if (graphics.outlineColor instanceof Cesium.ConstantProperty) {
    graphics.outlineColor.setValue(color)
    return
  }
  graphics.outlineColor = new Cesium.ConstantProperty(color)
}

export function setPolygonNumericProperty(
  Cesium: CesiumModule,
  property: CesiumType.Property | undefined,
  value: number,
  assign: (next: CesiumType.ConstantProperty) => void,
) {
  if (property instanceof Cesium.ConstantProperty) {
    property.setValue(value)
    return
  }
  assign(new Cesium.ConstantProperty(value))
}

export function setPolygonMaterialColor(Cesium: CesiumModule, graphics: CesiumType.PolygonGraphics, color: CesiumType.Color) {
  if (graphics.material instanceof Cesium.ColorMaterialProperty) {
    if (graphics.material.color instanceof Cesium.ConstantProperty) {
      graphics.material.color.setValue(color)
      return
    }
    graphics.material.color = new Cesium.ConstantProperty(color)
    return
  }
  graphics.material = new Cesium.ColorMaterialProperty(color)
}

export function setEllipseMaterialColor(Cesium: CesiumModule, graphics: CesiumType.EllipseGraphics, color: CesiumType.Color) {
  if (graphics.material instanceof Cesium.ColorMaterialProperty) {
    if (graphics.material.color instanceof Cesium.ConstantProperty) {
      graphics.material.color.setValue(color)
      return
    }
    graphics.material.color = new Cesium.ConstantProperty(color)
    return
  }
  graphics.material = new Cesium.ColorMaterialProperty(color)
}

export function setEllipseMaterialProperty(
  Cesium: CesiumModule,
  graphics: CesiumType.EllipseGraphics,
  property: CesiumType.Property,
) {
  if (graphics.material instanceof Cesium.ColorMaterialProperty) {
    graphics.material.color = property
    return
  }
  graphics.material = new Cesium.ColorMaterialProperty(property)
}

export function setEllipseColorProperty(
  Cesium: CesiumModule,
  property: CesiumType.Property | undefined,
  value: CesiumType.Color,
  assign: (next: CesiumType.ConstantProperty) => void,
) {
  if (property instanceof Cesium.ConstantProperty) {
    property.setValue(value)
    return
  }
  assign(new Cesium.ConstantProperty(value))
}

export function setEllipseNumericProperty(
  Cesium: CesiumModule,
  property: CesiumType.Property | undefined,
  value: number,
  assign: (next: CesiumType.ConstantProperty) => void,
) {
  if (property instanceof Cesium.ConstantProperty) {
    property.setValue(value)
    return
  }
  assign(new Cesium.ConstantProperty(value))
}

export function setPolylinePositions(
  Cesium: CesiumModule,
  graphics: CesiumType.PolylineGraphics,
  positions: CesiumType.Cartesian3[],
) {
  if (graphics.positions instanceof Cesium.ConstantProperty) {
    graphics.positions.setValue(positions)
    return
  }
  graphics.positions = new Cesium.ConstantProperty(positions)
}

export function breachPulseColorProperty(
  Cesium: CesiumModule,
  kind: 'fill' | 'outline',
) {
  return new Cesium.CallbackProperty((time?: unknown) => {
    const timeMs = time != null && 'JulianDate' in Cesium && Cesium.JulianDate != null && typeof Cesium.JulianDate.toDate === 'function'
      ? Cesium.JulianDate.toDate(time as CesiumType.JulianDate).getTime()
      : Date.now()
    const opacity = 0.5 + 0.35 * Math.sin((timeMs / 630) * Math.PI)
    const alpha = kind === 'fill'
      ? 0.04 + opacity * 0.04
      : 0.45 + opacity * 0.45
    return Cesium.Color.fromCssColorString('#fa5252').withAlpha(alpha)
  }, false)
}

export function setPolylineNumericProperty(
  Cesium: CesiumModule,
  property: CesiumType.Property | undefined,
  value: number,
  assign: (next: CesiumType.ConstantProperty) => void,
) {
  if (property instanceof Cesium.ConstantProperty) {
    property.setValue(value)
    return
  }
  assign(new Cesium.ConstantProperty(value))
}

export function setPolylineBooleanProperty(
  Cesium: CesiumModule,
  property: CesiumType.Property | undefined,
  value: boolean,
  assign: (next: CesiumType.ConstantProperty) => void,
) {
  if (property instanceof Cesium.ConstantProperty) {
    property.setValue(value)
    return
  }
  assign(new Cesium.ConstantProperty(value))
}

export function pruneEntityMap(
  viewer: CesiumType.Viewer,
  entityMap: Map<string, CesiumType.Entity>,
  currentIds: Set<string>,
) {
  for (const [key, entity] of entityMap) {
    if (!currentIds.has(key)) {
      viewer.entities.remove(entity)
      entityMap.delete(key)
    }
  }
}

export function prunePrimitiveMap(
  collection: CesiumType.PointPrimitiveCollection,
  primitiveMap: Map<string, CesiumType.PointPrimitive>,
  currentIds: Set<string>,
) {
  let removed = 0
  for (const [key, primitive] of primitiveMap) {
    if (!currentIds.has(key)) {
      collection.remove(primitive)
      primitiveMap.delete(key)
      removed += 1
    }
  }
  return removed
}

export function heatmapRadiusKm(intensity: number) {
  return HEATMAP_MIN_RADIUS_KM + (HEATMAP_MAX_RADIUS_KM - HEATMAP_MIN_RADIUS_KM) * Math.sqrt(Math.max(0, intensity))
}

export function heatmapColorCss(intensity: number) {
  if (intensity >= 0.85) return '#ef4444'
  if (intensity >= 0.65) return '#f97316'
  if (intensity >= 0.45) return '#facc15'
  if (intensity >= 0.25) return '#4ade80'
  return '#20a39e'
}

export function heatmapFillAlpha(intensity: number) {
  return 0.1 + intensity * 0.22
}

export function heatmapOutlineAlpha(intensity: number) {
  return 0.18 + intensity * 0.32
}

export function pickIdString(picked: unknown): { idString: string; pickedKind: 'primitive' | 'entity' } | null {
  if (!picked || typeof picked !== 'object' || !('id' in picked)) return null
  const pickedId = (picked as { id?: unknown }).id
  if (typeof pickedId === 'string') {
    return { idString: pickedId, pickedKind: 'primitive' }
  }
  if (pickedId && typeof pickedId === 'object' && 'id' in pickedId) {
    const nestedId = (pickedId as { id?: unknown }).id
    if (typeof nestedId === 'string') {
      return { idString: nestedId, pickedKind: 'entity' }
    }
  }
  return null
}

export type PickInspectionResult = {
  outcome:
    | 'miss'
    | 'invalid'
    | 'coverage-only'
    | 'site'
    | 'stale-site'
    | 'asset'
    | 'stale-asset'
    | 'signal'
    | 'stale-signal'
    | 'unknown-id'
  idString?: string
  pickedKind?: 'primitive' | 'entity'
}

export function resolvePickCandidates(
  candidates: Array<{ idString: string; pickedKind: 'primitive' | 'entity' }>,
  sites: Site[],
  assets: Asset[],
  signals: Signal[],
): PickInspectionResult {
  if (candidates.length === 0) return { outcome: 'miss' }

  let sawOverlay = false

  for (const candidate of candidates) {
    if (candidate.idString.startsWith('coverage-')) {
      sawOverlay = true
      continue
    }
    if (candidate.idString.startsWith('geofence-')) {
      sawOverlay = true
      continue
    }
    if (candidate.idString.startsWith('chokepoint-')) {
      sawOverlay = true
      continue
    }
    if (candidate.idString.startsWith('heatmap-')) {
      sawOverlay = true
      continue
    }
    if (candidate.idString === 'vessel-track') {
      continue
    }

    const { idString, pickedKind } = candidate

    if (idString.startsWith('site-')) {
      const siteId = idString.replace('site-', '')
      if (!sites.find(site => site.id === siteId)) {
        return { outcome: 'stale-site', pickedKind, idString }
      }
      return { outcome: 'site', pickedKind, idString }
    }

    if (idString.startsWith('asset-')) {
      const assetId = idString.replace('asset-', '')
      if (!assets.find(asset => asset.id === assetId)) {
        return { outcome: 'stale-asset', pickedKind, idString }
      }
      return { outcome: 'asset', pickedKind, idString }
    }

    if (idString.startsWith('signal-')) {
      const signalId = idString.replace('signal-', '')
      if (!signals.find(signal => signal.id === signalId)) {
        return { outcome: 'stale-signal', pickedKind, idString }
      }
      return { outcome: 'signal', pickedKind, idString }
    }

    return { outcome: 'unknown-id', pickedKind, idString }
  }

  return { outcome: sawOverlay ? 'coverage-only' : 'invalid' }
}
