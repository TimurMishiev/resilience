import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  CONFIDENCE_HALO_BEFORE_LAYER,
  CONFIDENCE_HALO_LAYER_ID,
  CONFIDENCE_HALO_SOURCE_ID,
  useMapConfidenceHaloLayers,
  type MapConfidenceHaloLayersInput,
} from '../hooks/map/useMapConfidenceHaloLayers'
import type { Site } from '../api/types'

function makeSite(overrides: Partial<Site> = {}): Site {
  return {
    id:                  'site-a',
    name:                'Site A',
    latitude:            10,
    longitude:           20,
    status:              'active',
    area_of_operation_id: null,
    flagged_at:          null,
    flag_reason:         null,
    geofence_radius_km:  10,
    created_at:          '2026-04-27T00:00:00.000Z',
    updated_at:          '2026-04-27T00:00:00.000Z',
    ...overrides,
  }
}

interface MapStub {
  addSource:  ReturnType<typeof vi.fn>
  addLayer:   ReturnType<typeof vi.fn>
  getSource:  ReturnType<typeof vi.fn>
  getLayer:   ReturnType<typeof vi.fn>
  _setData:   ReturnType<typeof vi.fn>
  _hasSource: boolean
  _knownLayers: Set<string>
}

function makeMapStub(opts: { knownLayers?: string[] } = {}): MapStub {
  const stub: MapStub = {
    addSource:    vi.fn(),
    addLayer:     vi.fn(),
    getSource:    vi.fn(),
    getLayer:     vi.fn(),
    _setData:     vi.fn(),
    _hasSource:   false,
    _knownLayers: new Set(opts.knownLayers ?? []),
  }
  stub.addSource.mockImplementation(() => { stub._hasSource = true })
  stub.getSource.mockImplementation(() =>
    stub._hasSource ? { setData: stub._setData } : undefined,
  )
  stub.getLayer.mockImplementation((id: string) =>
    stub._knownLayers.has(id) ? { id } : undefined,
  )
  return stub
}

function buildInput(stub: MapStub, overrides: Partial<MapConfidenceHaloLayersInput> = {}): MapConfidenceHaloLayersInput {
  return {
    mapRef: { current: stub as unknown as MapConfidenceHaloLayersInput['mapRef']['current'] },
    mapLoaded:   true,
    sites:       [makeSite()],
    summaries:   [],
    isReplaying: false,
    ...overrides,
  }
}

describe('useMapConfidenceHaloLayers', () => {
  it('does nothing when the map is not loaded', () => {
    const stub = makeMapStub({ knownLayers: ['site-circles'] })
    renderHook(() => useMapConfidenceHaloLayers(buildInput(stub, { mapLoaded: false, isReplaying: true, summaries: [{ site_id: 'site-a', confidence: 0.5 }] })))
    expect(stub.addSource).not.toHaveBeenCalled()
    expect(stub.addLayer).not.toHaveBeenCalled()
  })

  it('mounts an empty source in live mode and never produces features', () => {
    const stub = makeMapStub({ knownLayers: ['site-circles'] })
    renderHook(() => useMapConfidenceHaloLayers(
      buildInput(stub, {
        isReplaying: false,
        summaries:   [{ site_id: 'site-a', confidence: 0.92 }],
      }),
    ))

    expect(stub.addSource).toHaveBeenCalledTimes(1)
    const [sourceId, sourceConfig] = stub.addSource.mock.calls[0]
    expect(sourceId).toBe(CONFIDENCE_HALO_SOURCE_ID)
    expect(sourceConfig.type).toBe('geojson')
    expect(sourceConfig.data.features).toEqual([])
  })

  it('produces one feature per active site in replay mode, anchored at the site coordinates', () => {
    const stub = makeMapStub({ knownLayers: ['site-circles'] })
    const sites = [
      makeSite({ id: 'site-a', latitude: 10, longitude: 20 }),
      makeSite({ id: 'site-b', latitude: -3.5, longitude: 100.25 }),
    ]
    renderHook(() => useMapConfidenceHaloLayers(
      buildInput(stub, {
        isReplaying: true,
        sites,
        summaries: [
          { site_id: 'site-a', confidence: 0.85 },
          { site_id: 'site-b', confidence: 0.42 },
        ],
      }),
    ))

    const [, sourceConfig] = stub.addSource.mock.calls[0]
    expect(sourceConfig.data.features).toHaveLength(2)
    expect(sourceConfig.data.features[0]).toMatchObject({
      type: 'Feature',
      properties: { site_id: 'site-a', confidence: 0.85 },
      geometry:   { type: 'Point', coordinates: [20, 10] },
    })
    expect(sourceConfig.data.features[1]).toMatchObject({
      properties: { site_id: 'site-b', confidence: 0.42 },
      geometry:   { type: 'Point', coordinates: [100.25, -3.5] },
    })
  })

  it('drops summary rows whose site is absent from the current map dataset', () => {
    const stub = makeMapStub({ knownLayers: ['site-circles'] })
    renderHook(() => useMapConfidenceHaloLayers(
      buildInput(stub, {
        isReplaying: true,
        sites:       [makeSite({ id: 'site-a' })],
        summaries: [
          { site_id: 'site-a',     confidence: 0.85 },
          { site_id: 'site-ghost', confidence: 0.99 }, // not in dataset → dropped
        ],
      }),
    ))

    const [, sourceConfig] = stub.addSource.mock.calls[0]
    expect(sourceConfig.data.features).toHaveLength(1)
    expect(sourceConfig.data.features[0].properties.site_id).toBe('site-a')
  })

  it('clamps confidence into [0, 1] before emitting it on the feature', () => {
    const stub = makeMapStub({ knownLayers: ['site-circles'] })
    renderHook(() => useMapConfidenceHaloLayers(
      buildInput(stub, {
        isReplaying: true,
        summaries: [{ site_id: 'site-a', confidence: 1.42 }],
      }),
    ))

    const [, sourceConfig] = stub.addSource.mock.calls[0]
    expect(sourceConfig.data.features[0].properties.confidence).toBe(1)
  })

  it('adds the halo layer below site-circles via beforeLayer when present', () => {
    const stub = makeMapStub({ knownLayers: ['site-circles'] })
    renderHook(() => useMapConfidenceHaloLayers(
      buildInput(stub, {
        isReplaying: true,
        summaries:   [{ site_id: 'site-a', confidence: 0.85 }],
      }),
    ))

    expect(stub.addLayer).toHaveBeenCalledTimes(1)
    const [layerSpec, beforeLayer] = stub.addLayer.mock.calls[0]
    expect(layerSpec.id).toBe(CONFIDENCE_HALO_LAYER_ID)
    expect(layerSpec.type).toBe('circle')
    expect(layerSpec.source).toBe(CONFIDENCE_HALO_SOURCE_ID)
    expect(beforeLayer).toBe(CONFIDENCE_HALO_BEFORE_LAYER)
  })

  it('falls back gracefully when site-circles is not yet on the map', () => {
    const stub = makeMapStub({ knownLayers: [] })
    renderHook(() => useMapConfidenceHaloLayers(
      buildInput(stub, {
        isReplaying: true,
        summaries:   [{ site_id: 'site-a', confidence: 0.85 }],
      }),
    ))
    const [, beforeLayer] = stub.addLayer.mock.calls[0]
    expect(beforeLayer).toBeUndefined()
  })

  it('uses setData on subsequent renders rather than re-adding the source/layer', () => {
    const stub = makeMapStub({ knownLayers: ['site-circles'] })
    const { rerender } = renderHook((props: MapConfidenceHaloLayersInput) =>
      useMapConfidenceHaloLayers(props),
    {
      initialProps: buildInput(stub, {
        isReplaying: true,
        summaries:   [{ site_id: 'site-a', confidence: 0.50 }],
      }),
    })

    expect(stub.addSource).toHaveBeenCalledTimes(1)
    expect(stub.addLayer).toHaveBeenCalledTimes(1)

    rerender(buildInput(stub, {
      isReplaying: true,
      summaries:   [{ site_id: 'site-a', confidence: 0.95 }],
    }))

    expect(stub.addSource).toHaveBeenCalledTimes(1)
    expect(stub.addLayer).toHaveBeenCalledTimes(1)
    expect(stub._setData).toHaveBeenCalledTimes(1)
    const updatedData = stub._setData.mock.calls[0][0]
    expect(updatedData.features[0].properties.confidence).toBe(0.95)
  })

  it('clears features (via setData) when the operator exits replay', () => {
    const stub = makeMapStub({ knownLayers: ['site-circles'] })
    const { rerender } = renderHook((props: MapConfidenceHaloLayersInput) =>
      useMapConfidenceHaloLayers(props),
    {
      initialProps: buildInput(stub, {
        isReplaying: true,
        summaries:   [{ site_id: 'site-a', confidence: 0.85 }],
      }),
    })

    rerender(buildInput(stub, {
      isReplaying: false,
      summaries:   [{ site_id: 'site-a', confidence: 0.85 }],
    }))

    expect(stub._setData).toHaveBeenCalledTimes(1)
    const clearedData = stub._setData.mock.calls[0][0]
    expect(clearedData.features).toEqual([])
  })

  it('drives circle-opacity via a confidence-keyed interpolate paint expression', () => {
    const stub = makeMapStub({ knownLayers: ['site-circles'] })
    renderHook(() => useMapConfidenceHaloLayers(
      buildInput(stub, {
        isReplaying: true,
        summaries:   [{ site_id: 'site-a', confidence: 0.85 }],
      }),
    ))
    const [layerSpec] = stub.addLayer.mock.calls[0]
    const opacityExpr = layerSpec.paint['circle-opacity']
    expect(Array.isArray(opacityExpr)).toBe(true)
    expect(opacityExpr[0]).toBe('interpolate')
    expect(opacityExpr).toContainEqual(['get', 'confidence'])
  })
})
