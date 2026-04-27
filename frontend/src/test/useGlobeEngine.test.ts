/**
 * Adapter-level tests for useGlobeEngine.
 *
 * Strategy: mock preloadGlobeRuntime to return a controlled Cesium facade that
 * records viewer.entities.add/remove calls and exposes the PointPrimitiveCollection
 * for direct inspection.  A `fireCameraChanged(heightMeters)` helper lets tests
 * exercise the isCloseView threshold without a real Cesium render loop.
 *
 * What these tests prove:
 *   - viewerReady toggles correctly after viewer init
 *   - Site entities are added with the correct id prefix after viewerReady
 *   - Signal collection .show is toggled when showSignals changes
 *   - Coverage entity .show is set from showCoverage on creation and update
 *   - isCloseView flips when the camera crosses SIGNAL_CLOSE_VIEW_HEIGHT_M (2 000 000 m)
 *   - chokepoint entities are created, toggled, and pruned correctly
 */

import { renderHook, act } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/preloadRoutes', () => ({
  preloadGlobeRuntime: vi.fn(),
  preloadMapRuntime:   vi.fn(),
  preloadMapPage:      vi.fn(),
  preloadGlobePage:    vi.fn(),
  preloadMapExperience:   vi.fn(),
  preloadGlobeExperience: vi.fn(),
}))

vi.mock('../lib/perfInstrumentation', () => ({
  nowMs:           vi.fn(() => 0),
  recordPerfEvent: vi.fn(),
}))

import { preloadGlobeRuntime } from '../lib/preloadRoutes'
import { useGlobeEngine } from '../hooks/useGlobeEngine'
import type { GlobeEngineInput } from '../hooks/useGlobeEngine'
import type { Signal } from '../api/types'
import type { CoverageCircle } from '../lib/coverage'

// ---------------------------------------------------------------------------
// Cesium facade
// ---------------------------------------------------------------------------
//
// Minimal implementation of the Cesium API surface exercised by the hook.
// Entity and primitive operations are tracked so tests can assert on them
// without running a real WebGL context.

type FakeEntity = {
  id?: string
  name?: string
  show?: boolean
  position?: unknown
  point?: {
    color?: unknown
    heightReference?: unknown
    disableDepthTestDistance?: unknown
    outlineColor?: unknown
    outlineWidth?: unknown
  }
  label?: { text?: unknown; heightReference?: unknown; disableDepthTestDistance?: unknown }
  ellipse?: {
    semiMajorAxis?: unknown
    semiMinorAxis?: unknown
    material?: unknown
    outlineColor?: unknown
    outlineWidth?: unknown
    height?: unknown
  }
  polygon?: { hierarchy?: unknown; material?: unknown; outlineColor?: unknown; outlineWidth?: unknown; height?: unknown }
  polyline?: { positions?: unknown; material?: unknown; width?: unknown; clampToGround?: unknown }
}

type FakePrimitive = {
  id: string
  position: unknown
  color?: unknown
  outlineColor?: unknown
  outlineWidth?: number
  show?: boolean
  distanceDisplayCondition?: unknown
  disableDepthTestDistance?: number
}

type FakeCollection = {
  show: boolean
  primitives: FakePrimitive[]
  add:    (opts: unknown) => FakePrimitive
  remove: (p: FakePrimitive) => void
  get length(): number
}

function buildCesiumFacade() {
  // ---------- shared mutable state ------------------------------------------

  // Scalar ref lets tests set camera height before firing the camera event.
  const cameraState = { heightMeters: 20_000_000 }

  let cameraChangedListener: (() => void) | null = null
  let capturedSignalCollection: FakeCollection | null = null
  let leftClickAction: ((event: { position: { x: number; y: number } }) => void) | null = null
  let drillPickResults: unknown[] = []

  // ---------- class implementations -----------------------------------------

  class ConstantProperty {
    _v: unknown
    constructor(v: unknown) { this._v = v }
    setValue(v: unknown) { this._v = v }
    getValue() { return this._v }
  }

  class ConstantPositionProperty {
    _v: unknown
    constructor(v: unknown) { this._v = v }
    setValue(v: unknown) { this._v = v }
    getValue() { return this._v }
  }

  class ColorMaterialProperty {
    color: unknown
    constructor(c: unknown) { this.color = c }
  }

  class CallbackProperty {
    callback: (time?: unknown, result?: unknown) => unknown
    isConstant: boolean
    constructor(callback: (time?: unknown, result?: unknown) => unknown, isConstant: boolean) {
      this.callback = callback
      this.isConstant = isConstant
    }
    getValue(time?: unknown, result?: unknown) {
      return this.callback(time, result)
    }
  }

  class PolygonHierarchy {
    positions: unknown
    constructor(positions: unknown) {
      this.positions = positions
    }
  }

  class PolylineDashMaterialProperty {
    constructor(opts: unknown) {
      void opts
    }
  }

  class DistanceDisplayCondition {
    near: number
    far: number
    constructor(near: number, far: number) {
      this.near = near
      this.far = far
    }
  }

  class PointPrimitiveCollection implements FakeCollection {
    show = true
    primitives: FakePrimitive[] = []
    add(opts: unknown): FakePrimitive {
      const p = { ...(opts as object), show: true } as FakePrimitive
      this.primitives.push(p)
      return p
    }
    remove(p: FakePrimitive) {
      this.primitives = this.primitives.filter(x => x !== p)
    }
    get length() { return this.primitives.length }
  }

  class NearFarScalar {
    constructor(near: number, nearValue: number, far: number, farValue: number) {
      void near
      void nearValue
      void far
      void farValue
    }
  }
  class Cartesian2 {
    x: number
    y: number
    constructor(x = 0, y = 0) {
      this.x = x
      this.y = y
    }
  }
  class ScreenSpaceEventHandler {
    constructor(canvas: unknown) {
      void canvas
    }
    setInputAction(cb: unknown, type: unknown) {
      if (type === 0 && typeof cb === 'function') {
        leftClickAction = cb as (event: { position: { x: number; y: number } }) => void
      }
    }
    destroy() {
      leftClickAction = null
    }
  }
  class Credit {
    constructor(text: string) {
      void text
    }
  }
  class UrlTemplateImageryProvider {
    constructor(opts: unknown) {
      void opts
    }
  }
  class EllipsoidTerrainProvider {
    constructor(opts: unknown) {
      void opts
    }
  }

  // ---------- Color stub (all methods return the chain) ---------------------
  //
  // fromCssColorString returns a distinct object per call carrying the
  // original css string on _css, so tests can assert on the visual contract
  // (e.g. linked rings are blue #5282ff, evidence rings are amber #f5a623)
  // rather than just the mechanical outlineWidth signal.

  // `_alpha` captures the argument to withAlpha so tests can assert on the
  // freshness-driven alpha curve applied to asset point fills. Calls to
  // .withAlpha always return a new tagged instance, never the shared
  // constant reference — otherwise asset-A's alpha would overwrite asset-B's.
  type ColorLike = { _css?: string; _alpha?: number; withAlpha: (_a: number) => ColorLike }
  const colorSelf: ColorLike = {
    withAlpha: (alpha: number) => {
      const tagged: ColorLike = {
        _alpha: alpha,
        withAlpha: (nested: number) => {
          const deeper: ColorLike = {
            _alpha: nested,
            withAlpha: () => deeper,
          }
          return deeper
        },
      }
      return tagged
    },
  }
  const Color = {
    GRAY:         colorSelf,
    DODGERBLUE:   colorSelf,
    RED:          colorSelf,
    LIMEGREEN:    colorSelf,
    ORANGE:       colorSelf,
    CYAN:         colorSelf,
    BLACK:        colorSelf,
    WHITE:        colorSelf,
    TRANSPARENT:  colorSelf,
    fromCssColorString: (hex: string): ColorLike => {
      const base: ColorLike = {
        _css: hex,
        withAlpha: (alpha: number) => {
          const withA: ColorLike = {
            _css: hex,
            _alpha: alpha,
            withAlpha: (nested: number) => ({ ...withA, _alpha: nested }),
          }
          return withA
        },
      }
      return base
    },
  }

  // ---------- Entity registry -----------------------------------------------

  const entityRegistry = new Map<string, FakeEntity>()

  const entities = {
    add(spec: FakeEntity): FakeEntity {
      const entity: FakeEntity = {
        ...spec,
        show: spec.show ?? true,
        position: spec.position != null ? new ConstantPositionProperty(spec.position) : spec.position,
      }
      if (spec.id) entityRegistry.set(spec.id, entity)
      return entity
    },
    remove(entity: FakeEntity) {
      if (entity.id) entityRegistry.delete(entity.id)
    },
  }

  // ---------- Scene / camera -------------------------------------------------

  const scene = {
    primitives: {
      add(item: unknown) {
        if (item instanceof PointPrimitiveCollection) {
          capturedSignalCollection = item as unknown as FakeCollection
        }
        return item
      },
    },
    backgroundColor: null as unknown,
    globe: {
      depthTestAgainstTerrain: false,
      enableLighting:           false,
      showGroundAtmosphere:     false,
      baseColor:                null as unknown,
    },
    screenSpaceCameraController: {
      minimumZoomDistance:  0,
      maximumZoomDistance:  0,
      maximumTiltAngle:     0,
      inertiaSpin:          0,
      inertiaTranslate:     0,
      inertiaZoom:          0,
    },
    skyAtmosphere: {
      show:                         false,
      atmosphereLightIntensity:     0,
      atmosphereRayleighScaleHeight: 0,
    },
    fog:    { enabled: true },
    skyBox: { show: false },
    canvas: document.createElement('canvas'),
    drillPick: () => drillPickResults,
    cartesianToCanvasCoordinates: (cart: unknown) => {
      if (cart && typeof cart === 'object' && 'x' in cart && 'y' in cart) {
        return {
          x: Number((cart as { x: unknown }).x),
          y: Number((cart as { y: unknown }).y),
        }
      }
      return null
    },
  }

  const camera = {
    position: {} as unknown,
    changed: {
      addEventListener(cb: () => void) {
        cameraChangedListener = cb
      },
    },
    setView: vi.fn(),
    flyTo: vi.fn(),
  }

  // ---------- Cartographic (scratch pattern) --------------------------------
  //
  // The hook creates a `scratchCartographic = new Cesium.Cartographic()` and
  // then calls `Cesium.Cartographic.fromCartesian(pos, undefined, scratch)`.
  // Our mock populates `scratch.height` from `cameraState.heightMeters`.

  class Cartographic {
    height = cameraState.heightMeters
    static fromCartesian(
      _pos: unknown,
      _ellipsoid: unknown,
      result: { height: number },
    ) {
      result.height = cameraState.heightMeters
    }
  }

  // ---------- Viewer constructor --------------------------------------------

  const viewer = {
    entities,
    scene,
    camera,
    clock: { currentTime: new Date('2026-03-26T00:00:00Z') },
    destroy: vi.fn(),
  }

  const CesiumModule = {
    ConstantProperty,
    ConstantPositionProperty,
    CallbackProperty,
    ColorMaterialProperty,
    PolygonHierarchy,
    PolylineDashMaterialProperty,
    DistanceDisplayCondition,
    PointPrimitiveCollection,
    Cartographic,
    JulianDate: {
      toDate: (time: unknown) => time instanceof Date ? time : new Date('2026-03-26T00:00:00Z'),
    },
    Color,
    HeightReference: { CLAMP_TO_GROUND: 0 as unknown },
    Math: { toRadians: (deg: number) => (deg * Math.PI) / 180 },
    defined: (value: unknown) => value != null,
    Cartesian3: {
      fromDegrees:      (lng: number, lat: number, h?: number) => {
        return { x: lng, y: lat, z: h ?? 0 }
      },
      fromDegreesArray: (coords: number[]) => {
        return coords.map((value, index) => ({
          x: value,
          y: index,
          z: 0,
        })) as unknown[]
      },
    },
    Credit,
    UrlTemplateImageryProvider,
    ImageryLayer: {
      fromProviderAsync: (provider: unknown, opts: unknown) => {
        void provider
        void opts
        return {}
      },
    },
    EllipsoidTerrainProvider,
    NearFarScalar,
    Cartesian2,
    ScreenSpaceEventHandler,
    ScreenSpaceEventType: { LEFT_CLICK: 0 },
    LabelStyle: { FILL_AND_OUTLINE: 0 },
    Ion: { defaultAccessToken: '' },
    Viewer: vi.fn().mockImplementation(() => viewer),
  }

  return {
    CesiumModule,
    viewer,
    entityRegistry,
    getSignalCollection: () => capturedSignalCollection,
    setDrillPickResults(results: unknown[]) {
      drillPickResults = results
    },
    fireLeftClick(x: number, y: number) {
      leftClickAction?.({ position: { x, y } })
    },
    // Set camera height then fire the changed event
    fireCameraChanged(heightMeters: number) {
      cameraState.heightMeters = heightMeters
      cameraChangedListener?.()
    },
  }
}

type CesiumFacade = ReturnType<typeof buildCesiumFacade>

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const createdContainerEls: HTMLDivElement[] = []

function makeContainerRef() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  createdContainerEls.push(el)
  const creditsEl = document.createElement('div')
  document.body.appendChild(creditsEl)
  createdContainerEls.push(creditsEl)
  return {
    containerRef: { current: el }   as GlobeEngineInput['containerRef'],
    creditsRef:   { current: creditsEl } as GlobeEngineInput['creditsRef'],
  }
}

function defaultInput(
  refs: ReturnType<typeof makeContainerRef>,
  overrides: Partial<GlobeEngineInput> = {},
): GlobeEngineInput {
  return {
    containerRef:     refs.containerRef,
    creditsRef:       refs.creditsRef,
    sites:            [],
    assets:           [],
    signals:          [],
    tasksBySite:      {},
    areaOfOperations: [],
    breachedSiteIds:  new Set(),
    coverageCircles:  [],
    chokepoints:      [],
    vesselTracks:     [],
    assetTrails:      [],
    readings:         new Map(),
    showSignals:      true,
    showHeatmap:      false,
    showCoverage:     true,
    showChokepoints:  true,
    showTrails:       false,
    asOf:             undefined,
    isReplaying:      false,
    referenceTimeMs:  1704067200000,
    evidenceSiteIds:  [],
    evidenceSignalIds: [],
    signalFocusCenter: null,
    selectedSiteId:    null,
    selectedAssetId:   null,
    selectedSignalId:  null,
    replayPulses:     [],
    showReplayPulses: false,
    onSiteClick:   vi.fn(),
    onAssetClick:  vi.fn(),
    onSignalClick: vi.fn(),
    ...overrides,
  }
}

function makeSignal(id: string, lat: string, lng: string): Signal {
  return {
    id,
    source: 'gdacs',
    signal_type: 'disaster_alert',
    external_id: id,
    lat,
    lng,
    altitude: null,
    speed: null,
    heading: null,
    magnitude: null,
    raw_payload: {},
    occurred_at: '2024-01-01T00:00:00Z',
    ingested_at: '2024-01-01T00:00:01Z',
  }
}

function makeSite(overrides: Partial<GlobeEngineInput['sites'][number]> = {}) {
  return {
    id: 'site-1',
    name: 'Alpha',
    latitude: '10.0',
    longitude: '20.0',
    status: 'active',
    area_of_operation_id: null,
    flagged_at: null,
    flag_reason: null,
    geofence_radius_km: 0,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } satisfies GlobeEngineInput['sites'][number]
}

function makeAsset(overrides: Partial<GlobeEngineInput['assets'][number]> = {}) {
  return {
    id: 'asset-1',
    name: 'Drone 1',
    asset_type: 'drone',
    status: 'available',
    home_site_id: 'site-1',
    last_reported_at: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } satisfies GlobeEngineInput['assets'][number]
}

function makeArea(overrides: Partial<GlobeEngineInput['areaOfOperations'][number]> = {}) {
  return {
    id: 'ao-1',
    name: 'AO One',
    description: null,
    threat_level: 'amber',
    posture: 'observe',
    posture_changed_at: null,
    color: '#ff4757',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [20, 10],
        [21, 10],
        [21, 11],
        [20, 10],
      ]],
    },
    created_by_id: 'tester',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } satisfies GlobeEngineInput['areaOfOperations'][number]
}

function makeTrack(id: string, lat: string, lng: string) {
  return {
    id,
    lat,
    lng,
    speed: null,
    heading: null,
    occurred_at: '2024-01-01T00:00:00Z',
  } satisfies GlobeEngineInput['vesselTracks'][number]
}

function makeCoverageCircle(overrides: Partial<CoverageCircle> = {}): CoverageCircle {
  return {
    assetId: 'asset-1',
    assetName: 'Drone 1',
    assetType: 'vehicle',
    status: 'available',
    anchorKey: 'base',
    anchorLat: 10,
    anchorLng: 20,
    anchorSource: 'home_site',
    anchorLabel: 'Base',
    radiusKm: 50,
    ...overrides,
  }
}

function makeChokepoint(overrides: Partial<GlobeEngineInput['chokepoints'][number]> = {}) {
  return {
    id: 'cp-1',
    name: 'Narrows',
    status: 'monitor',
    category: 'strait',
    latitude: 12,
    longitude: 22,
    watch_radius_km: 40,
    area_of_operation_id: 'ao-1',
    area_of_operation_name: 'AO One',
    notes: null,
    created_by_id: 'user-1',
    updated_by_id: 'user-1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } satisfies GlobeEngineInput['chokepoints'][number]
}

/**
 * Boot the hook through the full init lifecycle:
 *  1. renderHook
 *  2. Flush the preloadGlobeRuntime Promise (microtask)
 *     → Viewer constructor runs, setViewerReady(true) is queued
 *  3. Flush the resulting React state update so viewerReady effects run
 */
async function bootGlobe(
  cesiumFacade: CesiumFacade,
  refs: ReturnType<typeof makeContainerRef>,
  input: GlobeEngineInput,
) {
  void cesiumFacade
  void refs
  const hook = renderHook((props: GlobeEngineInput) => useGlobeEngine(props), {
    initialProps: input,
  })

  // Flush preloadGlobeRuntime().then() so the Viewer is constructed
  await act(async () => {
    await Promise.resolve()
  })

  // Flush the React state update from setViewerReady(true)
  await act(async () => {
    await Promise.resolve()
  })

  return hook
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let cesium: CesiumFacade

beforeEach(() => {
  cesium = buildCesiumFacade()

  vi.mocked(preloadGlobeRuntime).mockResolvedValue(
    cesium.CesiumModule as unknown as Awaited<ReturnType<typeof preloadGlobeRuntime>>,
  )
})

afterEach(() => {
  while (createdContainerEls.length) {
    createdContainerEls.pop()?.remove()
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGlobeEngine adapter', () => {
  // ── Initialization ─────────────────────────────────────────────────────────

  describe('initialization', () => {
    it('reports viewerReady=true after the Viewer constructor resolves', async () => {
      const refs = makeContainerRef()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs))

      expect(hook.result.current.viewerReady).toBe(true)
    })

    it('calls the Viewer constructor with the container element', async () => {
      const refs = makeContainerRef()
      await bootGlobe(cesium, refs, defaultInput(refs))

      expect(cesium.CesiumModule.Viewer).toHaveBeenCalledWith(
        refs.containerRef.current,
        expect.any(Object),
      )
    })

    it('adds a PointPrimitiveCollection to scene.primitives for signals', async () => {
      const refs = makeContainerRef()
      await bootGlobe(cesium, refs, defaultInput(refs))

      expect(cesium.getSignalCollection()).not.toBeNull()
    })
  })

  // ── Site entity management ─────────────────────────────────────────────────
  //
  // Each site must be registered as `site-<id>` in viewer.entities so the
  // pick resolution and globe E2E bridge can address it by that key.

  describe('site entities', () => {
    it('adds a viewer entity with id="site-<siteId>" for each site', async () => {
      const refs = makeContainerRef()
      const sites = [
        { id: 'alpha', name: 'Alpha', latitude: '10.0', longitude: '20.0', status: 'active', geofence_radius_km: 0 },
        { id: 'beta',  name: 'Beta',  latitude: '30.0', longitude: '40.0', status: 'active', geofence_radius_km: 0 },
      ]
      await bootGlobe(cesium, refs, defaultInput(refs, { sites: sites as GlobeEngineInput['sites'] }))

      expect(cesium.entityRegistry.has('site-alpha')).toBe(true)
      expect(cesium.entityRegistry.has('site-beta')).toBe(true)
    })

    it('removes stale site entity when site is removed from the list', async () => {
      const refs = makeContainerRef()
      const site = { id: 'alpha', name: 'Alpha', latitude: '10.0', longitude: '20.0', status: 'active', geofence_radius_km: 0 }
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        sites: [site] as GlobeEngineInput['sites'],
      }))

      expect(cesium.entityRegistry.has('site-alpha')).toBe(true)

      await act(async () => {
        hook.rerender(defaultInput(refs, { sites: [] }))
        await Promise.resolve()
      })

      expect(cesium.entityRegistry.has('site-alpha')).toBe(false)
    })
  })

  describe('asset entities', () => {
    it('adds asset entities, updates telemetry-driven positions, and removes stale assets', async () => {
      const refs = makeContainerRef()
      const site = makeSite()
      const asset = makeAsset()
      const readings = new Map([
        ['asset-1', {
          asset_id: 'asset-1',
          name: 'Drone 1',
          lat: 14,
          lng: 24,
          heading: 90,
          speed: 12,
          battery: 80,
          ts: Date.now() / 1000,
        }],
      ])

      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        sites: [site],
        assets: [asset],
        readings,
      }))

      const entity = cesium.entityRegistry.get('asset-asset-1')!
      const position = entity.position as { getValue: () => unknown }
      expect(entity.name).toBe('Drone 1')
      expect(position.getValue()).toMatchObject({ x: 24, y: 14 })

      const nextReadings = new Map([
        ['asset-1', {
          asset_id: 'asset-1',
          name: 'Drone 1',
          lat: 15,
          lng: 25,
          heading: 120,
          speed: 16,
          battery: 76,
          ts: Date.now() / 1000,
        }],
      ])

      await act(async () => {
        hook.rerender(defaultInput(refs, {
          sites: [site],
          assets: [asset],
          readings: nextReadings,
        }))
        await Promise.resolve()
      })

      expect(position.getValue()).toMatchObject({ x: 25, y: 15 })

      await act(async () => {
        hook.rerender(defaultInput(refs, { sites: [site], assets: [] }))
        await Promise.resolve()
      })

      expect(cesium.entityRegistry.has('asset-asset-1')).toBe(false)
    })
  })

  describe('area and ring entities', () => {
    it('adds and removes AO, geofence, and breach entities as inputs change', async () => {
      const refs = makeContainerRef()
      const site = makeSite({ geofence_radius_km: 12 })
      const area = makeArea()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        sites: [site],
        areaOfOperations: [area],
        breachedSiteIds: new Set(['site-1']),
      }))

      expect(cesium.entityRegistry.has('ao-ao-1')).toBe(true)
      expect(cesium.entityRegistry.has('geofence-site-1')).toBe(true)
      expect(cesium.entityRegistry.has('geofence-breach-site-1')).toBe(true)

      await act(async () => {
        hook.rerender(defaultInput(refs, {
          sites: [makeSite({ geofence_radius_km: 0 })],
          areaOfOperations: [],
          breachedSiteIds: new Set(),
        }))
        await Promise.resolve()
      })

      expect(cesium.entityRegistry.has('ao-ao-1')).toBe(false)
      expect(cesium.entityRegistry.has('geofence-site-1')).toBe(false)
      expect(cesium.entityRegistry.has('geofence-breach-site-1')).toBe(false)
    })

    it('uses Cesium callback properties for active breach pulse colors instead of a JS timer', async () => {
      const refs = makeContainerRef()
      const site = makeSite({ geofence_radius_km: 12 })
      await bootGlobe(cesium, refs, defaultInput(refs, {
        sites: [site],
        breachedSiteIds: new Set(['site-1']),
      }))

      const breach = cesium.entityRegistry.get('geofence-breach-site-1')
      expect(breach?.ellipse?.material).toBeInstanceOf(cesium.CesiumModule.ColorMaterialProperty)
      expect((breach?.ellipse?.material as { color: unknown }).color).toBeInstanceOf(cesium.CesiumModule.CallbackProperty)
      expect(breach?.ellipse?.outlineColor).toBeInstanceOf(cesium.CesiumModule.CallbackProperty)
      expect(typeof ((breach?.ellipse?.outlineColor as { getValue: (time?: unknown) => unknown }).getValue(cesium.viewer.clock.currentTime))).toBe('object')
    })
  })

  // ── Signal collection visibility ───────────────────────────────────────────
  //
  // Signals use a PointPrimitiveCollection rather than individual entities.
  // The hook toggles collection.show directly, making visibility instant and
  // free (no per-point work).

  describe('signal collection visibility', () => {
    it('signal collection show=true when showSignals is true', async () => {
      const refs = makeContainerRef()
      await bootGlobe(cesium, refs, defaultInput(refs, { showSignals: true }))

      expect(cesium.getSignalCollection()!.show).toBe(true)
    })

    it('sets collection.show=false when showSignals becomes false', async () => {
      const refs = makeContainerRef()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, { showSignals: true }))

      await act(async () => {
        hook.rerender(defaultInput(refs, { showSignals: false }))
        await Promise.resolve()
      })

      expect(cesium.getSignalCollection()!.show).toBe(false)
    })

    it('sets collection.show=true when showSignals becomes true', async () => {
      const refs = makeContainerRef()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, { showSignals: false }))

      await act(async () => {
        hook.rerender(defaultInput(refs, { showSignals: true }))
        await Promise.resolve()
      })

      expect(cesium.getSignalCollection()!.show).toBe(true)
    })

    it('adds primitives to the signal collection for each signal', async () => {
      const refs = makeContainerRef()
      const signals: Signal[] = [
        makeSignal('s1', '10.0', '20.0'),
        makeSignal('s2', '11.0', '21.0'),
      ]
      await bootGlobe(cesium, refs, defaultInput(refs, { signals }))

      const col = cesium.getSignalCollection()!
      const ids = col.primitives.map(p => p.id)
      expect(ids).toContain('signal-s1')
      expect(ids).toContain('signal-s2')
    })

    it('keeps the selected signal and nearby signals when a focus center is active', async () => {
      const refs = makeContainerRef()
      const signals: Signal[] = [
        makeSignal('near', '10.01', '20.01'),
        makeSignal('far-selected', '50.0', '60.0'),
        makeSignal('far-hidden', '70.0', '80.0'),
      ]

      await bootGlobe(cesium, refs, defaultInput(refs, {
        signals,
        selectedSignalId: 'far-selected',
        signalFocusCenter: { lat: 10, lng: 20 },
      }))

      const ids = cesium.getSignalCollection()!.primitives.map(p => p.id)
      expect(ids).toContain('signal-near')
      expect(ids).toContain('signal-far-selected')
      expect(ids).not.toContain('signal-far-hidden')
    })
  })

  describe('signal heatmap overlay', () => {
    it('creates heatmap ellipse entities when heatmap is enabled', async () => {
      const refs = makeContainerRef()
      const signals: Signal[] = [
        makeSignal('s1', '10.0', '20.0'),
        makeSignal('s2', '10.2', '20.2'),
      ]

      await bootGlobe(cesium, refs, defaultInput(refs, {
        signals,
        showHeatmap: true,
      }))

      const heatmapIds = Array.from(cesium.entityRegistry.keys()).filter(id => id.startsWith('heatmap-'))
      expect(heatmapIds.length).toBeGreaterThan(0)
      expect(cesium.entityRegistry.get(heatmapIds[0])?.show).toBe(true)
    })

    it('updates existing heatmap entities when heatmap visibility changes', async () => {
      const refs = makeContainerRef()
      const signals: Signal[] = [
        makeSignal('s1', '10.0', '20.0'),
        makeSignal('s2', '10.2', '20.2'),
      ]

      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        signals,
        showHeatmap: true,
      }))

      const heatmapIds = Array.from(cesium.entityRegistry.keys()).filter(id => id.startsWith('heatmap-'))
      expect(heatmapIds.length).toBeGreaterThan(0)

      await act(async () => {
        hook.rerender(defaultInput(refs, {
          signals,
          showHeatmap: false,
        }))
        await Promise.resolve()
      })

      expect(cesium.entityRegistry.get(heatmapIds[0])?.show).toBe(false)
    })

    it('hides heatmap entities when signals are toggled off', async () => {
      const refs = makeContainerRef()
      const signals: Signal[] = [
        makeSignal('s1', '10.0', '20.0'),
        makeSignal('s2', '10.2', '20.2'),
      ]

      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        signals,
        showSignals: true,
        showHeatmap: true,
      }))

      const heatmapIds = Array.from(cesium.entityRegistry.keys()).filter(id => id.startsWith('heatmap-'))
      expect(heatmapIds.length).toBeGreaterThan(0)
      expect(cesium.entityRegistry.get(heatmapIds[0])?.show).toBe(true)

      await act(async () => {
        hook.rerender(defaultInput(refs, {
          signals,
          showSignals: false,
          showHeatmap: true,
        }))
        await Promise.resolve()
      })

      expect(cesium.entityRegistry.get(heatmapIds[0])?.show).toBe(false)
    })

    it('suppresses heatmap entities at close-view tactical zoom and restores them when zooming back out', async () => {
      const refs = makeContainerRef()
      const signals: Signal[] = [
        makeSignal('s1', '10.0', '20.0'),
        makeSignal('s2', '10.2', '20.2'),
      ]

      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        signals,
        showHeatmap: true,
      }))

      const heatmapIds = Array.from(cesium.entityRegistry.keys()).filter(id => id.startsWith('heatmap-'))
      expect(heatmapIds.length).toBeGreaterThan(0)
      expect(cesium.entityRegistry.get(heatmapIds[0])?.show).toBe(true)

      await act(async () => {
        cesium.fireCameraChanged(900_000)
      })

      expect(hook.result.current.isCloseView).toBe(true)
      expect(cesium.entityRegistry.get(heatmapIds[0])?.show).toBe(false)

      await act(async () => {
        cesium.fireCameraChanged(5_000_000)
      })

      expect(hook.result.current.isCloseView).toBe(false)
      expect(cesium.entityRegistry.get(heatmapIds[0])?.show).toBe(true)
    })
  })

  // ── Coverage entity visibility ─────────────────────────────────────────────
  //
  // Coverage circles use viewer.entities (not a collection) because they are
  // individually addressable for overlay passthrough pick resolution.  The
  // hook sets entity.show = showCoverage.

  describe('coverage entity visibility', () => {
    const circle = makeCoverageCircle()

    it('creates coverage entity with show=true when showCoverage is true', async () => {
      const refs = makeContainerRef()
      await bootGlobe(cesium, refs, defaultInput(refs, {
        coverageCircles: [circle],
        showCoverage:    true,
      }))

      const key = 'coverage-asset-1-base'
      expect(cesium.entityRegistry.has(key)).toBe(true)
      expect(cesium.entityRegistry.get(key)!.show).toBe(true)
    })

    it('creates coverage entity with show=false when showCoverage is false', async () => {
      const refs = makeContainerRef()
      await bootGlobe(cesium, refs, defaultInput(refs, {
        coverageCircles: [circle],
        showCoverage:    false,
      }))

      const key = 'coverage-asset-1-base'
      expect(cesium.entityRegistry.get(key)!.show).toBe(false)
    })

    it('updates existing coverage entity.show when showCoverage changes', async () => {
      const refs = makeContainerRef()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        coverageCircles: [circle],
        showCoverage:    true,
      }))

      await act(async () => {
        hook.rerender(defaultInput(refs, { coverageCircles: [circle], showCoverage: false }))
        await Promise.resolve()
      })

      const key = 'coverage-asset-1-base'
      expect(cesium.entityRegistry.get(key)!.show).toBe(false)
    })
  })

  describe('chokepoint entity lifecycle', () => {
    const chokepoint = makeChokepoint()

    it('creates chokepoint entity with show=true when showChokepoints is true', async () => {
      const refs = makeContainerRef()
      await bootGlobe(cesium, refs, defaultInput(refs, {
        chokepoints: [chokepoint],
        showChokepoints: true,
      }))

      const key = 'chokepoint-cp-1'
      expect(cesium.entityRegistry.has(key)).toBe(true)
      expect(cesium.entityRegistry.get(key)!.show).toBe(true)
    })

    it('updates existing chokepoint entity.show when showChokepoints changes', async () => {
      const refs = makeContainerRef()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        chokepoints: [chokepoint],
        showChokepoints: true,
      }))

      await act(async () => {
        hook.rerender(defaultInput(refs, {
          chokepoints: [chokepoint],
          showChokepoints: false,
        }))
        await Promise.resolve()
      })

      const key = 'chokepoint-cp-1'
      expect(cesium.entityRegistry.get(key)!.show).toBe(false)
    })

    it('prunes stale chokepoint entities when the chokepoint set becomes empty', async () => {
      const refs = makeContainerRef()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        chokepoints: [chokepoint],
      }))

      expect(cesium.entityRegistry.has('chokepoint-cp-1')).toBe(true)

      await act(async () => {
        hook.rerender(defaultInput(refs, { chokepoints: [] }))
        await Promise.resolve()
      })

      expect(cesium.entityRegistry.has('chokepoint-cp-1')).toBe(false)
    })
  })

  describe('vessel track lifecycle', () => {
    it('adds, updates, and removes the selected vessel track entity', async () => {
      const refs = makeContainerRef()
      const tracks = [makeTrack('t1', '10', '20'), makeTrack('t2', '11', '21')]
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        vesselTracks: tracks,
      }))

      expect(cesium.entityRegistry.has('vessel-track')).toBe(true)

      await act(async () => {
        hook.rerender(defaultInput(refs, {
          vesselTracks: [makeTrack('t1', '12', '22'), makeTrack('t2', '13', '23')],
        }))
        await Promise.resolve()
      })

      const entity = cesium.entityRegistry.get('vessel-track')!
      const positions = entity.polyline?.positions as { getValue: () => unknown[] }
      expect(positions.getValue()).toHaveLength(4)

      await act(async () => {
        hook.rerender(defaultInput(refs, { vesselTracks: [makeTrack('t1', '12', '22')] }))
        await Promise.resolve()
      })

      expect(cesium.entityRegistry.has('vessel-track')).toBe(false)
    })
  })

  describe('picking and projections', () => {
    it('dispatches synthetic picks to matching callbacks and ignores coverage overlays', async () => {
      const refs = makeContainerRef()
      const onSiteClick = vi.fn()
      const onSignalClick = vi.fn()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        sites: [makeSite()],
        signals: [makeSignal('sig-1', '10', '20')],
        onSiteClick,
        onSignalClick,
      }))

      expect(hook.result.current.dispatchSyntheticPick(['coverage-asset-1-base', 'site-site-1'])).toBe(true)
      expect(onSiteClick).toHaveBeenCalledWith('site-1')

      expect(hook.result.current.dispatchSyntheticPick(['signal-sig-1'])).toBe(true)
      expect(onSignalClick).toHaveBeenCalledWith('sig-1')
    })

    it('treats chokepoint-* as a passthrough overlay and resolves the underlying entity', async () => {
      const refs = makeContainerRef()
      const onSiteClick = vi.fn()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        sites: [makeSite()],
        onSiteClick,
      }))

      // chokepoint overlay on top, site underneath — site should win
      expect(hook.result.current.dispatchSyntheticPick(['chokepoint-cp-1', 'site-site-1'])).toBe(true)
      expect(onSiteClick).toHaveBeenCalledWith('site-1')
    })

    it('treats heatmap-* as a passthrough overlay and resolves the underlying entity', async () => {
      const refs = makeContainerRef()
      const onSiteClick = vi.fn()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        sites: [makeSite()],
        onSiteClick,
      }))

      expect(hook.result.current.dispatchSyntheticPick(['heatmap-40:80', 'site-site-1'])).toBe(true)
      expect(onSiteClick).toHaveBeenCalledWith('site-1')
    })

    it('does not clear the active selection when only chokepoint overlays are picked', async () => {
      const refs = makeContainerRef()
      const onSiteClick = vi.fn()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        sites: [makeSite()],
        selectedSiteId: 'site-1',
        onSiteClick,
      }))

      // only a chokepoint overlay in the pick stack — should not fire any callback
      expect(hook.result.current.dispatchSyntheticPick(['chokepoint-cp-1'])).toBe(false)
      expect(onSiteClick).not.toHaveBeenCalled()
    })

    it('toggles a selected site off when the same site is picked again', async () => {
      const refs = makeContainerRef()
      const onSiteClick = vi.fn()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        sites: [makeSite()],
        selectedSiteId: 'site-1',
        onSiteClick,
      }))

      expect(hook.result.current.dispatchSyntheticPick(['site-site-1'])).toBe(true)
      expect(onSiteClick).toHaveBeenCalledWith(null)
    })

    it('toggles a selected asset off when the same asset is picked again', async () => {
      const refs = makeContainerRef()
      const onAssetClick = vi.fn()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        assets: [makeAsset()],
        selectedAssetId: 'asset-1',
        onAssetClick,
      }))

      expect(hook.result.current.dispatchSyntheticPick(['asset-asset-1'])).toBe(true)
      expect(onAssetClick).toHaveBeenCalledWith(null)
    })

    it('toggles a selected signal off when the same signal is picked again', async () => {
      const refs = makeContainerRef()
      const onSignalClick = vi.fn()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        signals: [makeSignal('sig-1', '10', '20')],
        selectedSignalId: 'sig-1',
        onSignalClick,
      }))

      expect(hook.result.current.dispatchSyntheticPick(['signal-sig-1'])).toBe(true)
      expect(onSignalClick).toHaveBeenCalledWith(null)
    })

    it('does not clear the active selection when a real click misses every entity', async () => {
      const refs = makeContainerRef()
      const onAssetClick = vi.fn()
      await bootGlobe(cesium, refs, defaultInput(refs, {
        assets: [makeAsset()],
        selectedAssetId: 'asset-1',
        onAssetClick,
      }))

      cesium.setDrillPickResults([])
      await act(async () => {
        cesium.fireLeftClick(4, 8)
      })

      expect(onAssetClick).not.toHaveBeenCalled()
    })

    it('does not clear the active selection when only coverage overlays are picked', async () => {
      const refs = makeContainerRef()
      const onAssetClick = vi.fn()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        assets: [makeAsset()],
        coverageCircles: [makeCoverageCircle()],
        selectedAssetId: 'asset-1',
        onAssetClick,
      }))

      expect(hook.result.current.dispatchSyntheticPick(['coverage-asset-1-base'])).toBe(false)
      expect(onAssetClick).not.toHaveBeenCalled()
    })

    it('routes real drill-pick clicks and projects rendered positions', async () => {
      const refs = makeContainerRef()
      const onAssetClick = vi.fn()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        sites: [makeSite()],
        assets: [makeAsset()],
        signals: [makeSignal('sig-1', '10', '20')],
        onAssetClick,
      }))

      cesium.setDrillPickResults([{ id: { id: 'asset-asset-1' } }])
      await act(async () => {
        cesium.fireLeftClick(12, 34)
      })

      expect(onAssetClick).toHaveBeenCalledWith('asset-1')
      expect(hook.result.current.projectPosition(22, 11)).toEqual({ x: 22, y: 11 })
      expect(hook.result.current.projectRenderedPosition('signal-sig-1')).toEqual({ x: 20, y: 10 })
      expect(hook.result.current.projectRenderedPosition('site-site-1')).toEqual({ x: 20, y: 10 })
    })

    it('flies the camera for focused positions and the home view', async () => {
      const refs = makeContainerRef()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs))

      act(() => {
        hook.result.current.focusPosition(30, 40, 500_000, -45)
        hook.result.current.flyToHome()
      })

      expect(cesium.viewer.camera.flyTo).toHaveBeenCalledTimes(2)
      expect(cesium.viewer.camera.flyTo).toHaveBeenNthCalledWith(1, expect.objectContaining({
        destination: { x: 30, y: 40, z: 500_000 },
        duration: 1.35,
      }))
      expect(cesium.viewer.camera.flyTo).toHaveBeenNthCalledWith(2, expect.objectContaining({
        destination: { x: 10, y: 20, z: 18_000_000 },
        duration: 1.5,
      }))
    })
  })

  // ── Camera-driven isCloseView ──────────────────────────────────────────────
  //
  // isCloseView is true when camera altitude < 2 000 000 m.  The hook registers
  // a camera.changed listener that reads scratchCartographic.height.  Tests
  // exercise this via facade.fireCameraChanged(heightMeters).

  describe('isCloseView threshold', () => {
    it('starts with isCloseView=false when camera is far (altitude > 2 000 000 m)', async () => {
      const refs = makeContainerRef()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs))

      // Default camera height in facade is 20 000 000 m (far)
      expect(hook.result.current.isCloseView).toBe(false)
    })

    it('sets isCloseView=true when camera drops below 2 000 000 m', async () => {
      const refs = makeContainerRef()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs))

      await act(async () => {
        cesium.fireCameraChanged(900_000) // 900 km — below 2 000 km threshold
      })

      expect(hook.result.current.isCloseView).toBe(true)
    })

    it('sets isCloseView=false when camera climbs back above 2 000 000 m', async () => {
      const refs = makeContainerRef()
      const hook = await bootGlobe(cesium, refs, defaultInput(refs))

      await act(async () => {
        cesium.fireCameraChanged(900_000)
      })
      expect(hook.result.current.isCloseView).toBe(true)

      await act(async () => {
        cesium.fireCameraChanged(5_000_000)
      })
      expect(hook.result.current.isCloseView).toBe(false)
    })
  })

  // ── Linked-entity highlighting (CTO P1) ────────────────────────────────────
  describe('linked-entity highlighting', () => {
    // Parity mirror of useMapLibreEngine's linked-ring cross-highlight:
    //   select an asset → highlight its home site
    //   select a site   → highlight assets rooted at that site
    // The facade captures `point.outlineColor` and `point.outlineWidth` so the
    // tests can assert on the ConstantProperty values after a re-render.

    function getOutlineWidth(entity: FakeEntity): number | undefined {
      const prop = entity.point?.outlineWidth as { getValue?: () => unknown } | undefined
      const value = prop?.getValue?.()
      return typeof value === 'number' ? value : undefined
    }

    // Returns the css color string the outline was set from. The facade's
    // Color constructor records the original css string on fromCssColorString,
    // which lets tests assert on the visual contract (blue for linked, amber
    // for evidence) rather than just the mechanical outlineWidth signal.
    function getOutlineCss(entity: FakeEntity): string | undefined {
      const prop = entity.point?.outlineColor as { getValue?: () => unknown } | undefined
      const value = prop?.getValue?.() as { _css?: string; _css_color?: string } | undefined
      return value?._css ?? value?._css_color
    }

    it('applies linked-highlight outline to the selected asset\'s home site', async () => {
      const refs  = makeContainerRef()
      const sites = [
        makeSite({ id: 'site-1', name: 'Alpha',  latitude: '10', longitude: '20' }),
        makeSite({ id: 'site-2', name: 'Bravo',  latitude: '11', longitude: '21' }),
      ]
      const assets = [
        makeAsset({ id: 'asset-1', home_site_id: 'site-1' }),
        makeAsset({ id: 'asset-2', home_site_id: 'site-2' }),
      ]
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        sites, assets,
      }))

      // Baseline: no selection → both sites get default outline width
      const site1Before = cesium.entityRegistry.get('site-site-1')!
      const site2Before = cesium.entityRegistry.get('site-site-2')!
      expect(getOutlineWidth(site1Before)).toBe(2)
      expect(getOutlineWidth(site2Before)).toBe(2)

      // Select asset-1 → its home_site (site-1) gets the linked outline
      await act(async () => {
        hook.rerender(defaultInput(refs, { sites, assets, selectedAssetId: 'asset-1' }))
      })
      const site1After = cesium.entityRegistry.get('site-site-1')!
      const site2After = cesium.entityRegistry.get('site-site-2')!
      expect(getOutlineWidth(site1After)).toBe(4)
      expect(getOutlineWidth(site2After)).toBe(2)
    })

    it('applies linked-highlight outline to every asset rooted at the selected site', async () => {
      const refs  = makeContainerRef()
      const sites = [makeSite({ id: 'site-1' }), makeSite({ id: 'site-2' })]
      const assets = [
        makeAsset({ id: 'asset-1', home_site_id: 'site-1' }),
        makeAsset({ id: 'asset-2', home_site_id: 'site-1' }),
        makeAsset({ id: 'asset-3', home_site_id: 'site-2' }),
      ]
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        sites, assets, selectedSiteId: 'site-1',
      }))

      const linkedAssetIds = (['asset-1', 'asset-2', 'asset-3'] as const).filter((id) => {
        const entity = cesium.entityRegistry.get(`asset-${id}`)
        return entity != null && getOutlineWidth(entity) === 4
      })
      expect(linkedAssetIds).toEqual(expect.arrayContaining(['asset-1', 'asset-2']))
      expect(linkedAssetIds).not.toContain('asset-3')

      // Deselect → every asset returns to default outline width
      await act(async () => {
        hook.rerender(defaultInput(refs, { sites, assets, selectedSiteId: null }))
      })
      for (const id of ['asset-1', 'asset-2', 'asset-3']) {
        expect(getOutlineWidth(cesium.entityRegistry.get(`asset-${id}`)!)).toBe(2)
      }
    })

    it('clears linked-highlight on the site when its linked asset is deselected', async () => {
      const refs  = makeContainerRef()
      const sites  = [makeSite({ id: 'site-1' })]
      const assets = [makeAsset({ id: 'asset-1', home_site_id: 'site-1' })]
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        sites, assets, selectedAssetId: 'asset-1',
      }))
      expect(getOutlineWidth(cesium.entityRegistry.get('site-site-1')!)).toBe(4)

      await act(async () => {
        hook.rerender(defaultInput(refs, { sites, assets, selectedAssetId: null }))
      })
      expect(getOutlineWidth(cesium.entityRegistry.get('site-site-1')!)).toBe(2)
    })

    // ── Evidence-linked ring (P1 slice 2) ────────────────────────────────
    it('applies the evidence-linked amber outline to sites in evidenceSiteIds', async () => {
      const refs  = makeContainerRef()
      const sites = [
        makeSite({ id: 'site-1' }),
        makeSite({ id: 'site-2' }),
        makeSite({ id: 'site-3' }),
      ]
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        sites,
        evidenceSiteIds: ['site-1', 'site-3'],
      }))

      const s1 = cesium.entityRegistry.get('site-site-1')!
      const s2 = cesium.entityRegistry.get('site-site-2')!
      const s3 = cesium.entityRegistry.get('site-site-3')!

      // Evidence outline: amber (#f5a623) width 3
      expect(getOutlineWidth(s1)).toBe(3)
      expect(getOutlineCss(s1)).toBe('#f5a623')
      expect(getOutlineWidth(s3)).toBe(3)
      expect(getOutlineCss(s3)).toBe('#f5a623')

      // Non-matching site: default outline, not amber
      expect(getOutlineWidth(s2)).toBe(2)
      expect(getOutlineCss(s2)).not.toBe('#f5a623')

      // Clearing evidenceSiteIds returns every site to default
      await act(async () => {
        hook.rerender(defaultInput(refs, { sites, evidenceSiteIds: [] }))
      })
      for (const id of ['site-1', 'site-2', 'site-3']) {
        expect(getOutlineWidth(cesium.entityRegistry.get(`site-${id}`)!)).toBe(2)
      }
    })

    // ── Asset freshness alpha (P1 follow-up — consumes the threaded clock) ──
    it('maps asset telemetry freshness to the point-fill alpha curve from the map surface', async () => {
      // Each asset has a distinct last_reported_at that places it in a
      // specific freshness bucket relative to referenceTimeMs (fixed clock).
      // Asserts the visible contract: fresh=0.94, aging=0.72, stale=0.46,
      // unavailable=0.32. Matches useMapAssetLayers circle-opacity table.
      const refs  = makeContainerRef()
      const now   = 1_735_000_000_000

      const sites  = [makeSite({ id: 'site-1' })]
      const assets = [
        makeAsset({ id: 'a-fresh',       home_site_id: 'site-1', last_reported_at: new Date(now - 60_000).toISOString() }),
        makeAsset({ id: 'a-aging',       home_site_id: 'site-1', last_reported_at: new Date(now - 10 * 3_600_000).toISOString() }),
        makeAsset({ id: 'a-stale',       home_site_id: 'site-1', last_reported_at: new Date(now - 30 * 3_600_000).toISOString() }),
        makeAsset({ id: 'a-unavailable', home_site_id: 'site-1', last_reported_at: 'not-a-date' }),
      ]

      await bootGlobe(cesium, refs, defaultInput(refs, {
        sites, assets, referenceTimeMs: now,
      }))

      function getFillAlpha(assetId: string): number | undefined {
        const entity = cesium.entityRegistry.get(`asset-${assetId}`)
        const prop = entity?.point?.color as { getValue?: () => unknown } | undefined
        const value = prop?.getValue?.() as { _alpha?: number } | undefined
        return value?._alpha
      }

      expect(getFillAlpha('a-fresh')).toBeCloseTo(0.94, 5)
      expect(getFillAlpha('a-aging')).toBeCloseTo(0.72, 5)
      expect(getFillAlpha('a-stale')).toBeCloseTo(0.46, 5)
      expect(getFillAlpha('a-unavailable')).toBeCloseTo(0.32, 5)
    })

    it('re-applies freshness alpha when referenceTimeMs advances (live tick or replay scrub)', async () => {
      // An asset that is fresh at t0 becomes stale at t0 + 30h. Re-rendering
      // with a later referenceTimeMs must re-run the freshness effect and
      // lower the alpha, not leave it stuck at the first-render value.
      const refs = makeContainerRef()
      const t0   = 1_735_000_000_000
      const reportedAt = new Date(t0 - 60_000).toISOString() // 1 minute before t0

      const sites  = [makeSite({ id: 'site-1' })]
      const assets = [makeAsset({ id: 'a-1', home_site_id: 'site-1', last_reported_at: reportedAt })]

      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        sites, assets, referenceTimeMs: t0,
      }))

      function getFillAlpha(): number | undefined {
        const entity = cesium.entityRegistry.get('asset-a-1')
        const prop = entity?.point?.color as { getValue?: () => unknown } | undefined
        const value = prop?.getValue?.() as { _alpha?: number } | undefined
        return value?._alpha
      }

      expect(getFillAlpha()).toBeCloseTo(0.94, 5)

      await act(async () => {
        hook.rerender(defaultInput(refs, {
          sites, assets, referenceTimeMs: t0 + 30 * 3_600_000,
        }))
      })

      // 30 hours after last report → stale bucket
      expect(getFillAlpha()).toBeCloseTo(0.46, 5)
    })

    it('prefers linked-highlight over evidence when a site is both', async () => {
      // A site that is both evidence-linked (via the selected signal) AND the
      // home_site of the selected asset must render the blue linked ring, not
      // the amber evidence ring. Matches the map layer-order contract where
      // site-linked-ring paints over site-evidence-ring.
      const refs  = makeContainerRef()
      const sites  = [makeSite({ id: 'site-1' })]
      const assets = [makeAsset({ id: 'asset-1', home_site_id: 'site-1' })]
      await bootGlobe(cesium, refs, defaultInput(refs, {
        sites, assets,
        selectedAssetId: 'asset-1',
        evidenceSiteIds: ['site-1'],
      }))

      const entity = cesium.entityRegistry.get('site-site-1')!
      expect(getOutlineWidth(entity)).toBe(4)
      expect(getOutlineCss(entity)).toBe('#5282ff')
    })

    // ── Signal-side evidence ring on PointPrimitives ─────────────────────
    it('applies the amber evidence outline to signal primitives in evidenceSignalIds', async () => {
      const refs    = makeContainerRef()
      const signals = [
        makeSignal('sig-1', '10', '20'),
        makeSignal('sig-2', '11', '21'),
        makeSignal('sig-3', '12', '22'),
      ]
      const hook = await bootGlobe(cesium, refs, defaultInput(refs, {
        signals,
        evidenceSignalIds: ['sig-1', 'sig-3'],
      }))

      function getPrimitiveOutlineCss(id: string): string | undefined {
        const collection = cesium.getSignalCollection()
        const primitive = collection?.primitives.find(p => p.id === `signal-${id}`)
        const value = primitive?.outlineColor as { _css?: string } | undefined
        return value?._css
      }

      // Evidence-linked → amber
      expect(getPrimitiveOutlineCss('sig-1')).toBe('#f5a623')
      expect(getPrimitiveOutlineCss('sig-3')).toBe('#f5a623')
      // Non-evidence → default (per-signal-type base color, not amber)
      expect(getPrimitiveOutlineCss('sig-2')).not.toBe('#f5a623')

      // Clearing evidenceSignalIds reverts all outlines to default
      await act(async () => {
        hook.rerender(defaultInput(refs, { signals, evidenceSignalIds: [] }))
      })
      expect(getPrimitiveOutlineCss('sig-1')).not.toBe('#f5a623')
      expect(getPrimitiveOutlineCss('sig-3')).not.toBe('#f5a623')
    })
  })
})
