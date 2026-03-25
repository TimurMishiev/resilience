export const MAP_SIGNAL_CLUSTER_RADIUS = 56
export const MAP_SIGNAL_CLUSTER_MAX_ZOOM = 9

export type SignalClusterFeatureLike = {
  properties?: Record<string, unknown>
  geometry?: GeoJSON.Geometry | null
}

export type SignalClusterMapLike = {
  getZoom: () => number
  on: (event: 'moveend', handler: () => void) => void
  off: (event: 'moveend', handler: () => void) => void
  easeTo: (options: { center: [number, number]; zoom: number }) => void
}

export type SignalClusterSourceLike = {
  getClusterExpansionZoom: (clusterId: number) => Promise<number>
}

export function buildClusteredSignalSourceDefinition(data: GeoJSON.FeatureCollection) {
  return {
    type: 'geojson' as const,
    data,
    cluster: true,
    clusterRadius: MAP_SIGNAL_CLUSTER_RADIUS,
    clusterMaxZoom: MAP_SIGNAL_CLUSTER_MAX_ZOOM,
  }
}

function parseClusterId(feature: SignalClusterFeatureLike): number | null {
  const rawClusterId = feature.properties?.cluster_id
  const clusterId = typeof rawClusterId === 'number' ? rawClusterId : Number(rawClusterId)
  return Number.isFinite(clusterId) ? clusterId : null
}

function parseClusterCenter(feature: SignalClusterFeatureLike): [number, number] | null {
  const geometry = feature.geometry
  if (!geometry || !('coordinates' in geometry)) return null

  const coordinates = geometry.coordinates
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null

  const lng = Number(coordinates[0])
  const lat = Number(coordinates[1])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null

  return [lng, lat]
}

export async function expandMapSignalCluster(
  map: SignalClusterMapLike,
  source: SignalClusterSourceLike,
  feature: SignalClusterFeatureLike,
): Promise<boolean> {
  const clusterId = parseClusterId(feature)
  const center = parseClusterCenter(feature)
  if (clusterId === null || center === null) return false

  try {
    const zoom = await source.getClusterExpansionZoom(clusterId)
    if (Math.abs(map.getZoom() - zoom) < 0.01) return true

    const didReachTarget = await new Promise<boolean>(resolve => {
      let settled = false
      let timeoutId: ReturnType<typeof setTimeout> | null = null

      const finish = (result: boolean) => {
        if (settled) return
        settled = true
        if (timeoutId !== null) clearTimeout(timeoutId)
        map.off('moveend', handleMoveEnd)
        resolve(result)
      }

      const handleMoveEnd = () => finish(true)

      map.on('moveend', handleMoveEnd)
      timeoutId = setTimeout(() => finish(false), 5_000)
      map.easeTo({ center, zoom })
    })
    return didReachTarget
  } catch {
    return false
  }
}
