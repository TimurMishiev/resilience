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

export const MAP_INTERACTIVE_LAYER_IDS = Object.keys(MAP_INTERACTIVE_LAYER_KIND_BY_ID)

export function resolveMapClickCandidate(features: readonly MapFeatureLike[]) {
  for (const feature of features) {
    const layerId = feature.layer?.id
    if (!layerId) continue

    const kind = MAP_INTERACTIVE_LAYER_KIND_BY_ID[layerId]
    if (!kind) continue

    return {
      kind,
      feature,
      layerId,
    }
  }

  return null
}
