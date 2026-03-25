export type MapInteractiveKind = 'site' | 'asset' | 'signal' | 'cluster'

type MapFeatureLike = {
  layer?: {
    id?: string
  }
  properties?: Record<string, unknown>
}

const MAP_INTERACTIVE_LAYER_KIND_BY_ID: Record<string, MapInteractiveKind> = {
  'site-circles': 'site',
  'site-selection-ring': 'site',
  'asset-circles': 'asset',
  'asset-symbols': 'asset',
  'asset-selection-ring': 'asset',
  'signal-clusters': 'cluster',
  'signal-cluster-count': 'cluster',
  'signal-circles': 'signal',
  'signal-symbols': 'signal',
  'selected-signal-ring': 'signal',
  'selected-signal-circle': 'signal',
  'selected-signal-symbol': 'signal',
}

const MAP_INTERACTIVE_KIND_PRIORITY: Record<MapInteractiveKind, number> = {
  // Tactical map clicks should favor stable operational anchors over transient
  // overlays when multiple entities stack onto the same screen point.
  site: 4,
  asset: 3,
  signal: 2,
  cluster: 1,
}

export const MAP_INTERACTIVE_LAYER_IDS = Object.keys(MAP_INTERACTIVE_LAYER_KIND_BY_ID)

export function resolveMapClickCandidate(features: readonly MapFeatureLike[]) {
  let bestCandidate: {
    kind: MapInteractiveKind
    feature: MapFeatureLike
    layerId: string
  } | null = null
  let bestPriority = -1

  for (const feature of features) {
    const layerId = feature.layer?.id
    if (!layerId) continue

    const kind = MAP_INTERACTIVE_LAYER_KIND_BY_ID[layerId]
    if (!kind) continue

    const priority = MAP_INTERACTIVE_KIND_PRIORITY[kind]
    if (priority <= bestPriority) continue

    bestCandidate = {
      kind,
      feature,
      layerId,
    }
    bestPriority = priority
  }

  return bestCandidate
}
