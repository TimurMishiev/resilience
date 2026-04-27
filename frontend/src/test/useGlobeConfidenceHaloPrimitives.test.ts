import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HALO_OPACITY_FLOOR,
  HALO_OPACITY_RANGE,
  HALO_OUTLINE_FLOOR,
  HALO_OUTLINE_RANGE,
  HALO_PIXEL_SIZE,
  useGlobeConfidenceHaloPrimitives,
  type GlobeConfidenceHaloPrimitivesInput,
} from '../hooks/globe/useGlobeConfidenceHaloPrimitives'
import type { Site } from '../api/types'
import type { ActiveSiteConfidence } from '../api/signal_rule_matches'

// ── Tiny Cesium fake — same pattern as useGlobeReplayPulseLayers.test.ts.

interface FakePrimitive {
  position:     { lng: number; lat: number } | null
  pixelSize:    number
  color:        { css: string; alpha: number }
  outlineColor: { css: string; alpha: number }
  outlineWidth: number
}
interface FakePrimitiveCollection {
  primitives: FakePrimitive[]
  add: (opts: Partial<FakePrimitive>) => FakePrimitive
  remove: (p: FakePrimitive) => void
  destroyed: boolean
}

function createFakeCollection(): FakePrimitiveCollection {
  const primitives: FakePrimitive[] = []
  return {
    primitives,
    destroyed: false,
    add(opts) {
      const p: FakePrimitive = {
        position:     (opts.position ?? null) as FakePrimitive['position'],
        pixelSize:    opts.pixelSize ?? 0,
        color:        (opts.color ?? { css: '', alpha: 1 }) as FakePrimitive['color'],
        outlineColor: (opts.outlineColor ?? { css: '', alpha: 0 }) as FakePrimitive['outlineColor'],
        outlineWidth: opts.outlineWidth ?? 0,
      }
      primitives.push(p)
      return p
    },
    remove(p) {
      const idx = primitives.indexOf(p)
      if (idx >= 0) primitives.splice(idx, 1)
    },
  }
}

interface FakeViewer {
  scene: {
    primitives: { items: FakePrimitiveCollection[]; add: (c: FakePrimitiveCollection) => void; remove: (c: FakePrimitiveCollection) => void }
  }
  destroyed: boolean
  isDestroyed: () => boolean
}

function createFakeViewer(): FakeViewer {
  const items: FakePrimitiveCollection[] = []
  return {
    scene: {
      primitives: {
        items,
        add(c) { items.push(c) },
        remove(c) {
          const idx = items.indexOf(c)
          if (idx >= 0) items.splice(idx, 1)
          c.destroyed = true
        },
      },
    },
    destroyed: false,
    isDestroyed() { return this.destroyed },
  }
}

const fakeCesium = {
  PointPrimitiveCollection: function () { return createFakeCollection() } as unknown as new () => FakePrimitiveCollection,
  Cartesian3: { fromDegrees: (lng: number, lat: number) => ({ lng, lat }) },
  Color: {
    fromCssColorString: (css: string) => ({
      css,
      alpha: 1,
      withAlpha(alpha: number) { return { ...this, alpha } },
    }),
  },
}

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

function summary(site_id: string, confidence: number): ActiveSiteConfidence {
  return { site_id, confidence }
}

function buildInput(overrides: Partial<GlobeConfidenceHaloPrimitivesInput> = {}): {
  input: GlobeConfidenceHaloPrimitivesInput
  viewer: FakeViewer
} {
  const viewer = createFakeViewer()
  return {
    viewer,
    input: {
      viewerRef:   { current: viewer as unknown as GlobeConfidenceHaloPrimitivesInput['viewerRef']['current'] },
      cesiumRef:   { current: fakeCesium as unknown as GlobeConfidenceHaloPrimitivesInput['cesiumRef']['current'] },
      viewerReady: true,
      sites:       [makeSite()],
      summaries:   [],
      isReplaying: false,
      ...overrides,
    },
  }
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

describe('useGlobeConfidenceHaloPrimitives', () => {
  it('does nothing when the viewer is not ready', () => {
    const { input, viewer } = buildInput({
      viewerReady: false,
      isReplaying: true,
      summaries:   [summary('site-a', 0.8)],
    })
    renderHook(() => useGlobeConfidenceHaloPrimitives(input))
    expect(viewer.scene.primitives.items).toHaveLength(0)
  })

  it('does not mount the collection when isReplaying is false (live-mode no-op contract)', () => {
    const { input, viewer } = buildInput({
      isReplaying: false,
      summaries:   [summary('site-a', 0.8)],
    })
    renderHook(() => useGlobeConfidenceHaloPrimitives(input))
    expect(viewer.scene.primitives.items).toHaveLength(0)
  })

  it('mounts a dedicated PointPrimitiveCollection and adds one halo per active site when replaying', () => {
    const { input, viewer } = buildInput({
      isReplaying: true,
      sites:       [makeSite({ id: 'site-a' }), makeSite({ id: 'site-b', latitude: -3, longitude: 100 })],
      summaries:   [summary('site-a', 0.85), summary('site-b', 0.42)],
    })
    renderHook(() => useGlobeConfidenceHaloPrimitives(input))
    expect(viewer.scene.primitives.items).toHaveLength(1)
    // Single primitive per site (NOT halo+core dual like the 6-B pulse).
    expect(viewer.scene.primitives.items[0]?.primitives).toHaveLength(2)
  })

  it('paints each halo at the locked pixelSize and confidence-driven amber alpha', () => {
    const { input, viewer } = buildInput({
      isReplaying: true,
      summaries:   [summary('site-a', 0.85)],
    })
    renderHook(() => useGlobeConfidenceHaloPrimitives(input))
    const primitive = viewer.scene.primitives.items[0]?.primitives[0]
    expect(primitive?.pixelSize).toBe(HALO_PIXEL_SIZE)
    expect(primitive?.color.css).toBe('#f59f00')
    expect(primitive?.color.alpha).toBeCloseTo(HALO_OPACITY_FLOOR + HALO_OPACITY_RANGE * 0.85, 6)
    expect(primitive?.outlineColor.alpha).toBeCloseTo(HALO_OUTLINE_FLOOR + HALO_OUTLINE_RANGE * 0.85, 6)
  })

  it('drops summary rows whose site_id is absent from the current sites dataset', () => {
    const { input, viewer } = buildInput({
      isReplaying: true,
      sites:       [makeSite({ id: 'site-a' })],
      summaries:   [summary('site-a', 0.5), summary('site-ghost', 0.99)],
    })
    renderHook(() => useGlobeConfidenceHaloPrimitives(input))
    expect(viewer.scene.primitives.items[0]?.primitives).toHaveLength(1)
  })

  it('clamps confidence into [0, 1] before computing alpha', () => {
    const { input, viewer } = buildInput({
      isReplaying: true,
      summaries:   [summary('site-a', 1.42)],
    })
    renderHook(() => useGlobeConfidenceHaloPrimitives(input))
    const primitive = viewer.scene.primitives.items[0]?.primitives[0]
    expect(primitive?.color.alpha).toBeCloseTo(HALO_OPACITY_FLOOR + HALO_OPACITY_RANGE, 6)
  })

  it('updates an existing primitive in place when its confidence changes (no add/remove)', () => {
    const { input, viewer } = buildInput({
      isReplaying: true,
      summaries:   [summary('site-a', 0.40)],
    })
    const { rerender } = renderHook(
      (props: GlobeConfidenceHaloPrimitivesInput) => useGlobeConfidenceHaloPrimitives(props),
      { initialProps: input },
    )

    const collection = viewer.scene.primitives.items[0]
    expect(collection?.primitives).toHaveLength(1)
    const initial = collection?.primitives[0]

    rerender({ ...input, summaries: [summary('site-a', 0.95)] })

    expect(collection?.primitives).toHaveLength(1)
    expect(collection?.primitives[0]).toBe(initial)
    expect(initial?.color.alpha).toBeCloseTo(HALO_OPACITY_FLOOR + HALO_OPACITY_RANGE * 0.95, 6)
  })

  it('prunes a primitive when its site drops from the active summary set', () => {
    const { input, viewer } = buildInput({
      isReplaying: true,
      sites:       [makeSite({ id: 'site-a' }), makeSite({ id: 'site-b', latitude: -3, longitude: 100 })],
      summaries:   [summary('site-a', 0.50), summary('site-b', 0.60)],
    })
    const { rerender } = renderHook(
      (props: GlobeConfidenceHaloPrimitivesInput) => useGlobeConfidenceHaloPrimitives(props),
      { initialProps: input },
    )

    expect(viewer.scene.primitives.items[0]?.primitives).toHaveLength(2)

    rerender({ ...input, summaries: [summary('site-a', 0.50)] })

    expect(viewer.scene.primitives.items[0]?.primitives).toHaveLength(1)
  })

  it('removes the collection on replay exit (cleanup invoked)', () => {
    const { input, viewer } = buildInput({
      isReplaying: true,
      summaries:   [summary('site-a', 0.85)],
    })
    const { rerender } = renderHook(
      (props: GlobeConfidenceHaloPrimitivesInput) => useGlobeConfidenceHaloPrimitives(props),
      { initialProps: input },
    )

    expect(viewer.scene.primitives.items).toHaveLength(1)

    rerender({ ...input, isReplaying: false })

    expect(viewer.scene.primitives.items).toHaveLength(0)
  })

  it('removes the collection on unmount (no leaks)', () => {
    const { input, viewer } = buildInput({
      isReplaying: true,
      summaries:   [summary('site-a', 0.85)],
    })
    const { unmount } = renderHook(() => useGlobeConfidenceHaloPrimitives(input))

    expect(viewer.scene.primitives.items).toHaveLength(1)

    unmount()

    expect(viewer.scene.primitives.items).toHaveLength(0)
  })

  it('does not double-remove the collection if the viewer is already destroyed', () => {
    const { input, viewer } = buildInput({
      isReplaying: true,
      summaries:   [summary('site-a', 0.85)],
    })
    const { unmount } = renderHook(() => useGlobeConfidenceHaloPrimitives(input))

    viewer.destroyed = true
    expect(() => unmount()).not.toThrow()
  })
})
