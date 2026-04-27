import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGlobeReplayPulseLayers, type GlobeReplayPulseLayersInput } from '../hooks/globe/useGlobeReplayPulseLayers'
import type { Pulse } from '../lib/replayEventPulses'

// ── Tiny Cesium fake — only the surface this sub-hook touches. The
// useGlobeEngine integration test exercises the real Cesium mock; this
// test stays narrow on the sub-hook's lifecycle contract.

interface FakePrimitive {
  position: unknown
  pixelSize: number
  color: { alpha: number }
  outlineColor: { alpha: number }
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
        position:     opts.position ?? null,
        pixelSize:    opts.pixelSize ?? 0,
        color:        (opts.color ?? { alpha: 1 }) as FakePrimitive['color'],
        outlineColor: (opts.outlineColor ?? { alpha: 0 }) as FakePrimitive['outlineColor'],
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

type PreRenderListener = (scene: unknown, time: unknown) => void

interface FakeEvent {
  listeners: PreRenderListener[]
  addEventListener: (cb: PreRenderListener) => void
  removeEventListener: (cb: PreRenderListener) => void
}

function createFakeEvent(): FakeEvent {
  const listeners: PreRenderListener[] = []
  return {
    listeners,
    addEventListener(cb) {
      listeners.push(cb)
    },
    removeEventListener(cb) {
      const idx = listeners.indexOf(cb)
      if (idx >= 0) listeners.splice(idx, 1)
    },
  }
}

interface FakeViewer {
  scene: {
    primitives: { items: FakePrimitiveCollection[]; add: (c: FakePrimitiveCollection) => void; remove: (c: FakePrimitiveCollection) => void }
    preRender: FakeEvent
  }
  isDestroyed: () => boolean
  destroyed: boolean
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
      preRender: createFakeEvent(),
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
    WHITE: {
      alpha: 1,
      withAlpha(alpha: number) { return { ...this, alpha } },
    },
  },
  JulianDate: {
    toDate: () => new Date(0),
  },
}

function makePulse(id: string, intensity = 0.8): Pulse {
  return {
    id,
    lat: 10,
    lng: 20,
    eventType: 'site_flagged',
    occurredAt: '2026-04-26T12:00:00.000Z',
    intensity,
  }
}

function buildInput(overrides: Partial<GlobeReplayPulseLayersInput> = {}): {
  input: GlobeReplayPulseLayersInput
  viewer: FakeViewer
} {
  const viewer = createFakeViewer()
  return {
    viewer,
    input: {
      viewerRef: { current: viewer as unknown as GlobeReplayPulseLayersInput['viewerRef']['current'] },
      cesiumRef: { current: fakeCesium as unknown as GlobeReplayPulseLayersInput['cesiumRef']['current'] },
      viewerReady: true,
      pulses: [],
      showReplayPulses: false,
      ...overrides,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useGlobeReplayPulseLayers', () => {
  it('does nothing when the viewer is not ready', () => {
    const { input, viewer } = buildInput({ viewerReady: false, showReplayPulses: true, pulses: [makePulse('a')] })
    renderHook(() => useGlobeReplayPulseLayers(input))
    expect(viewer.scene.primitives.items).toHaveLength(0)
    expect(viewer.scene.preRender.listeners).toHaveLength(0)
  })

  it('does not mount the collection when showReplayPulses is false', () => {
    const { input, viewer } = buildInput({ showReplayPulses: false, pulses: [makePulse('a')] })
    renderHook(() => useGlobeReplayPulseLayers(input))
    expect(viewer.scene.primitives.items).toHaveLength(0)
    expect(viewer.scene.preRender.listeners).toHaveLength(0)
  })

  it('mounts a dedicated PointPrimitiveCollection and adds halo+core per pulse when toggled on', () => {
    const { input, viewer } = buildInput({ showReplayPulses: true, pulses: [makePulse('a'), makePulse('b')] })
    renderHook(() => useGlobeReplayPulseLayers(input))
    expect(viewer.scene.primitives.items).toHaveLength(1)
    // Two pulses × halo+core = 4 primitives
    expect(viewer.scene.primitives.items[0]?.primitives).toHaveLength(4)
  })

  it('registers exactly one preRender listener while pulses are present', () => {
    const { input, viewer } = buildInput({ showReplayPulses: true, pulses: [makePulse('a')] })
    renderHook(() => useGlobeReplayPulseLayers(input))
    expect(viewer.scene.preRender.listeners).toHaveLength(1)
  })

  it('does not register a preRender listener when there are zero pulses', () => {
    const { input, viewer } = buildInput({ showReplayPulses: true, pulses: [] })
    renderHook(() => useGlobeReplayPulseLayers(input))
    // The collection is mounted (so future pulses can attach without a remount)
    expect(viewer.scene.primitives.items).toHaveLength(1)
    // …but the per-frame breath loop only arms when there are pulses to drive.
    expect(viewer.scene.preRender.listeners).toHaveLength(0)
  })

  it('removes the collection AND the preRender listener on unmount (no leaks)', () => {
    const { input, viewer } = buildInput({ showReplayPulses: true, pulses: [makePulse('a')] })
    const { unmount } = renderHook(() => useGlobeReplayPulseLayers(input))
    expect(viewer.scene.primitives.items).toHaveLength(1)
    expect(viewer.scene.preRender.listeners).toHaveLength(1)

    unmount()

    expect(viewer.scene.primitives.items).toHaveLength(0)
    expect(viewer.scene.preRender.listeners).toHaveLength(0)
  })

  it('uses an undefined id on each primitive so pulses cannot steal click picks (pickIdString contract)', () => {
    const { input, viewer } = buildInput({ showReplayPulses: true, pulses: [makePulse('a')] })
    renderHook(() => useGlobeReplayPulseLayers(input))
    const collection = viewer.scene.primitives.items[0]!
    for (const primitive of collection.primitives) {
      // The fake's add() preserves any `id` on the input; absence here =
      // sub-hook never set one. pickIdString in globeEngineHelpers.ts:339
      // only resolves picks for primitives whose id is a string, so an
      // undefined id makes the pulse non-pickable.
      expect((primitive as unknown as Record<string, unknown>).id).toBeUndefined()
    }
  })
})
