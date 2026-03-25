import { describe, expect, it, vi } from 'vitest'
import {
  buildClusteredSignalSourceDefinition,
  expandMapSignalCluster,
  MAP_SIGNAL_CLUSTER_MAX_ZOOM,
  MAP_SIGNAL_CLUSTER_RADIUS,
  type SignalClusterFeatureLike,
  type SignalClusterMapLike,
  type SignalClusterSourceLike,
} from '../lib/mapSignalClustering'

describe('buildClusteredSignalSourceDefinition', () => {
  it('enables clustering with the tactical map signal defaults', () => {
    const data: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { id: 'sig-1' },
          geometry: { type: 'Point', coordinates: [10, 20] },
        },
      ],
    }

    expect(buildClusteredSignalSourceDefinition(data)).toEqual({
      type: 'geojson',
      data,
      cluster: true,
      clusterRadius: MAP_SIGNAL_CLUSTER_RADIUS,
      clusterMaxZoom: MAP_SIGNAL_CLUSTER_MAX_ZOOM,
    })
  })
})

describe('expandMapSignalCluster', () => {
  function makeMap(overrides?: Partial<SignalClusterMapLike>): SignalClusterMapLike {
    let moveEndHandler: (() => void) | null = null
    return {
      getZoom: () => 4,
      on: vi.fn((_event, handler) => {
        moveEndHandler = handler
      }),
      off: vi.fn((_event, handler) => {
        if (moveEndHandler === handler) moveEndHandler = null
      }),
      easeTo: vi.fn(() => {
        moveEndHandler?.()
      }),
      ...overrides,
    }
  }

  function makeSource(overrides?: Partial<SignalClusterSourceLike>): SignalClusterSourceLike {
    return {
      getClusterExpansionZoom: vi.fn(async () => 7),
      ...overrides,
    }
  }

  const validFeature: SignalClusterFeatureLike = {
    properties: { cluster_id: 42 },
    geometry: {
      type: 'Point',
      coordinates: [-122.4194, 37.7749],
    },
  }

  it('zooms to the cluster expansion target when the map is not already there', async () => {
    const map = makeMap()
    const source = makeSource()

    await expect(expandMapSignalCluster(map, source, validFeature)).resolves.toBe(true)

    expect(source.getClusterExpansionZoom).toHaveBeenCalledWith(42)
    expect(map.easeTo).toHaveBeenCalledWith({ center: [-122.4194, 37.7749], zoom: 7 })
    expect(map.off).toHaveBeenCalledTimes(1)
  })

  it('returns success without reanimating when already at the expansion zoom', async () => {
    const easeTo = vi.fn()
    const map = makeMap({
      getZoom: () => 7,
      easeTo,
    })
    const source = makeSource()

    await expect(expandMapSignalCluster(map, source, validFeature)).resolves.toBe(true)

    expect(source.getClusterExpansionZoom).toHaveBeenCalledWith(42)
    expect(map.on).not.toHaveBeenCalled()
    expect(map.off).not.toHaveBeenCalled()
    expect(easeTo).not.toHaveBeenCalled()
  })

  it('fails closed for malformed cluster features', async () => {
    const map = makeMap()
    const source = makeSource()

    await expect(expandMapSignalCluster(map, source, { properties: {}, geometry: null })).resolves.toBe(false)
    expect(source.getClusterExpansionZoom).not.toHaveBeenCalled()
  })

  it('fails closed and unregisters the moveend handler when expansion never completes', async () => {
    vi.useFakeTimers()

    let registeredHandler: (() => void) | null = null
    const map = makeMap({
      on: vi.fn((_event, handler) => {
        registeredHandler = handler
      }),
      off: vi.fn((_event, handler) => {
        if (registeredHandler === handler) registeredHandler = null
      }),
      easeTo: vi.fn(),
    })
    const source = makeSource()

    const expansionPromise = expandMapSignalCluster(map, source, validFeature)
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(expansionPromise).resolves.toBe(false)
    expect(map.off).toHaveBeenCalledTimes(1)
    expect(registeredHandler).toBeNull()

    vi.useRealTimers()
  })
})
