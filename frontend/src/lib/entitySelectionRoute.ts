export interface EntitySelectionRouteState {
  siteId: string | null
  assetId: string | null
  signalId: string | null
}

const ENTITY_SELECTION_PARAM_KEYS = ['site_id', 'asset_id', 'signal_id'] as const

function normalizeEntitySelectionRoute(selection: EntitySelectionRouteState): EntitySelectionRouteState {
  if (selection.siteId) {
    return { siteId: selection.siteId, assetId: null, signalId: null }
  }
  if (selection.assetId) {
    return { siteId: null, assetId: selection.assetId, signalId: null }
  }
  if (selection.signalId) {
    return { siteId: null, assetId: null, signalId: selection.signalId }
  }
  return { siteId: null, assetId: null, signalId: null }
}

export function parseEntitySelectionRoute(search: string): EntitySelectionRouteState {
  const params = new URLSearchParams(search)

  return normalizeEntitySelectionRoute({
    siteId: params.get('site_id'),
    assetId: params.get('asset_id'),
    signalId: params.get('signal_id'),
  })
}

export function hasEntitySelectionRoute(search: string): boolean {
  const { siteId, assetId, signalId } = parseEntitySelectionRoute(search)
  return Boolean(siteId || assetId || signalId)
}

export function buildEntitySelectionSearch(
  search: string,
  selection: EntitySelectionRouteState,
): string {
  const params = new URLSearchParams(search)

  for (const key of ENTITY_SELECTION_PARAM_KEYS) {
    params.delete(key)
  }

  const normalized = normalizeEntitySelectionRoute(selection)
  if (normalized.siteId) params.set('site_id', normalized.siteId)
  if (normalized.assetId) params.set('asset_id', normalized.assetId)
  if (normalized.signalId) params.set('signal_id', normalized.signalId)

  const nextSearch = params.toString()
  return nextSearch ? `?${nextSearch}` : ''
}

export function buildMapGlobeSelectionPath(
  pathname: '/map' | '/globe',
  search: string,
): string {
  return buildEntitySelectionPath(pathname, '', parseEntitySelectionRoute(search))
}

export function buildEntitySelectionPath(
  pathname: string,
  search: string,
  selection: EntitySelectionRouteState,
): string {
  return `${pathname}${buildEntitySelectionSearch(search, selection)}`
}

export function clearEntitySelectionRoute(search: string): string {
  return buildEntitySelectionSearch(search, {
    siteId: null,
    assetId: null,
    signalId: null,
  })
}
