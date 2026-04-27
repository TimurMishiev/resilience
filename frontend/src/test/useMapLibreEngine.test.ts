/**
 * Adapter-level tests for useMapLibreEngine.
 *
 * Strategy: mock preloadMapRuntime to return a controlled MapLibre facade
 * that records every imperative call and lets tests fire map events
 * (load, style.load) synchronously.  No real MapLibre canvas required.
 *
 * What these tests prove:
 *   - mapLoaded toggles correctly across init and style switch
 *   - Style switch calls setStyle, drops mapLoaded, and re-adds all layers
 *     after style.load fires (proving layers survive the style lifecycle)
 *   - Selection ring setFilter is called with the exact MapLibre expression
 *   - showSignals toggle hides/shows all 9 signal layers and clears
 *     selection on hide (the critical path that prevents stale signal state)
 *   - showCoverage toggle hides/shows coverage fill and stroke layers
 *   - showHeatmap toggle hides/shows the dedicated heatmap layer
 *   - chokepoint layers are created, toggled, and emptied deterministically
 */

import { renderHook, act } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/preloadRoutes', () => ({
  preloadMapRuntime: vi.fn(),
  preloadGlobeRuntime: vi.fn(),
  preloadMapPage: vi.fn(),
  preloadGlobePage: vi.fn(),
  preloadMapExperience: vi.fn(),
  preloadGlobeExperience: vi.fn(),
}))

import { preloadMapRuntime } from '../lib/preloadRoutes'
import { useMapLibreEngine } from '../hooks/useMapLibreEngine'
import type { MapEngineInput } from '../hooks/useMapLibreEngine'

// ---------------------------------------------------------------------------
// MapLibre map facade
// ---------------------------------------------------------------------------
//
// Tracks all imperative calls in insertion order.  Lets tests drive the
// load / style.load lifecycle by calling facade.fire(event).
// Simulates MapLibre's source/layer clearing on setStyle.

type CallRecord = { method: string; args: unknown[] }

function buildMapFacade() {
  const eventHandlers: Record<string, Array<(e?: unknown) => void>> = {}
  const calls: CallRecord[] = []
  const layerIds = new Set<string>()
  const sources: Record<string, { setData: (d: unknown) => void }> = {}
  const canvas = { style: { cursor: '' } }
  let queryRenderedFeaturesResult: unknown[] = []

  function track(method: string, ...args: unknown[]) {
    calls.push({ method, args })
  }

  const facade = {
    calls,
    layerIds,

    // ── Test helper: fire an event as if MapLibre dispatched it ────────────
    fire(event: string, data?: unknown) {
      for (const h of [...(eventHandlers[event] ?? [])]) h(data)
    },

    // ── Event subscription ─────────────────────────────────────────────────
    // Accepts map.on('load', cb) and map.on('mouseenter', 'layerId', cb)
    on(event: string, ...rest: unknown[]) {
      const cb = (rest.length >= 2 ? rest[1] : rest[0]) as ((e?: unknown) => void) | undefined
      if (typeof cb !== 'function') return
      ;(eventHandlers[event] ??= []).push(cb)
    },
    off(event: string, ...rest: unknown[]) {
      const cb = (rest.length >= 2 ? rest[1] : rest[0]) as ((e?: unknown) => void) | undefined
      if (!cb || !eventHandlers[event]) return
      eventHandlers[event] = eventHandlers[event]!.filter(h => h !== cb)
    },
    once(event: string, cb: (e?: unknown) => void) {
      const wrapped = (e?: unknown) => {
        cb(e)
        eventHandlers[event] = (eventHandlers[event] ?? []).filter(h => h !== wrapped)
      }
      ;(eventHandlers[event] ??= []).push(wrapped)
    },

    // ── Source / layer management ──────────────────────────────────────────
    addSource(id: string, spec: unknown) {
      void spec
      track('addSource', id)
      sources[id] = { setData: (d: unknown) => track('setData', id, d) }
    },
    getSource(id: string) {
      return sources[id]
    },
    removeSource(id: string) {
      track('removeSource', id)
      delete sources[id]
    },
    addLayer(spec: { id: string }, before?: unknown) {
      void before
      track('addLayer', spec.id, spec)
      layerIds.add(spec.id)
    },
    getLayer(id: string) {
      return layerIds.has(id) ? { id } : undefined
    },
    removeLayer(id: string) {
      track('removeLayer', id)
      layerIds.delete(id)
    },

    // ── Style management ───────────────────────────────────────────────────
    // Wipes all sources/layers — mirrors MapLibre's actual style-switch behaviour.
    setStyle(style: unknown) {
      track('setStyle', style)
      layerIds.clear()
      Object.keys(sources).forEach(k => { delete sources[k] })
    },

    // ── Layer property mutations ───────────────────────────────────────────
    setFilter(layerId: string, filter: unknown) {
      track('setFilter', layerId, filter)
    },
    setLayoutProperty(layerId: string, prop: string, value: unknown) {
      track('setLayoutProperty', layerId, prop, value)
    },
    setPaintProperty(layerId: string, prop: string, value: unknown) {
      track('setPaintProperty', layerId, prop, value)
    },

    // ── Map utilities ──────────────────────────────────────────────────────
    addControl(ctrl: unknown, pos?: string) {
      void ctrl
      void pos
    },
    remove() { track('remove') },
    getCanvas() { return canvas },
    queryRenderedFeatures(point?: unknown, opts?: unknown): unknown[] {
      void point
      void opts
      return queryRenderedFeaturesResult
    },
    project(lngLat: unknown) {
      void lngLat
      return { x: 100, y: 200 }
    },
    getZoom() { return 1.5 },
    flyTo(opts: unknown) { track('flyTo', opts) },
    setQueryRenderedFeaturesResult(features: unknown[]) {
      queryRenderedFeaturesResult = features
    },
  }

  return facade
}

type MapFacade = ReturnType<typeof buildMapFacade>

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const createdContainerEls: HTMLDivElement[] = []

function makeContainerRef(): { current: HTMLDivElement } {
  const el = document.createElement('div')
  document.body.appendChild(el)
  createdContainerEls.push(el)
  return { current: el }
}

function defaultInput(
  containerRef: { current: HTMLDivElement },
  overrides: Partial<MapEngineInput> = {},
): MapEngineInput {
  return {
    containerRef: containerRef as MapEngineInput['containerRef'],
    sites: [],
    assets: [],
    signals: [],
    tasksBySite: {},
    areaOfOperations: [],
    breachedSiteIds: new Set(),
    vesselTracks: [],
    assetTrails: [],
    coverageCircles: [],
    chokepoints: [],
    readings: new Map(),
    showSignals: true,
    showCoverage: true,
    showHeatmap: false,
    showChokepoints: true,
    showTrails: false,
    mapStyle: 'tactical',
    isReplaying: false,
    referenceTimeMs: Date.parse('2026-03-26T12:00:00.000Z'),
    selectedSiteId: null,
    selectedAssetId: null,
    selectedSignalId: null,
    annotationMode: false,
    annotations: [],
    rangeRingMode: false,
    rangeRingAnchor: null,
    rangeRingRadiiKm: [],
    rangeRingUnit: 'nm',
    sectorMode: false,
    sectorAnchor: null,
    sectorDegrees: 45,
    sectorArcDegrees: 60,
    sectorDistanceKm: 37.04,
    sectorUnit: 'nm',
    bearingLineMode: false,
    bearingLineAnchor: null,
    bearingLineDegrees: 45,
    bearingLineDistanceKm: 37.04,
    bearingLineUnit: 'nm',
    measurementMode: false,
    measurementPoints: [],
    evidenceSignalIds: [],
    evidenceSiteIds: [],
    replayPulses: [],
    showReplayPulses: false,
    onSiteClick: vi.fn(),
    onAssetClick: vi.fn(),
    onSignalClick: vi.fn(),
    onMapAnnotationClick: vi.fn(),
    onMapRangeRingAnchorClick: vi.fn(),
    onMapSectorAnchorClick: vi.fn(),
    onMapBearingLineAnchorClick: vi.fn(),
    onMapCoordinateClick: vi.fn(),
    ...overrides,
  }
}

/**
 * Boot the hook through the full init lifecycle:
 *  1. renderHook
 *  2. Flush the preloadMapRuntime Promise (microtask)
 *  3. Fire 'load' → setMapLoaded(true) → all mapLoaded-gated effects run
 */
async function bootMap(
  facade: MapFacade,
  containerRef: { current: HTMLDivElement },
  input: MapEngineInput,
) {
  void containerRef
  const hook = renderHook((props: MapEngineInput) => useMapLibreEngine(props), {
    initialProps: input,
  })

  // Flush the preloadMapRuntime().then() microtask so the Map constructor runs
  await act(async () => {
    await Promise.resolve()
  })

  // Fire 'load' → setMapLoaded(true) → React re-renders, all effects run
  await act(async () => {
    facade.fire('load')
  })

  return hook
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let facade: MapFacade

beforeEach(() => {
  facade = buildMapFacade()

  vi.mocked(preloadMapRuntime).mockResolvedValue({
    Map: vi.fn().mockImplementation(() => facade),
    NavigationControl: vi.fn(),
    Popup: vi.fn().mockImplementation(() => ({
      setLngLat: vi.fn().mockReturnThis(),
      setDOMContent: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
    })),
  } as unknown as Awaited<ReturnType<typeof preloadMapRuntime>>)
})

afterEach(() => {
  while (createdContainerEls.length) {
    createdContainerEls.pop()?.remove()
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useMapLibreEngine adapter', () => {
  // ── Initialization ────────────────────────────────────────────────────────

  describe('initialization', () => {
    it('reports mapLoaded=true after the load event fires', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef))

      expect(hook.result.current.mapLoaded).toBe(true)
    })

    it('adds site, signal, coverage, and chokepoint layers once mapLoaded becomes true', async () => {
      const containerRef = makeContainerRef()
      await bootMap(facade, containerRef, defaultInput(containerRef))

      // Site layer group
      expect(facade.layerIds.has('site-circles')).toBe(true)
      expect(facade.layerIds.has('site-selection-ring')).toBe(true)

      // Signal layer group
      expect(facade.layerIds.has('signal-heatmap')).toBe(true)
      expect(facade.layerIds.has('signal-clusters')).toBe(true)
      expect(facade.layerIds.has('signal-circles')).toBe(true)
      expect(facade.layerIds.has('signal-symbols')).toBe(true)
      expect(facade.layerIds.has('selected-signal-ring')).toBe(true)

      // Coverage layer group
      expect(facade.layerIds.has('sensor-coverage-fill')).toBe(true)

      // Chokepoint layer group
      expect(facade.layerIds.has('chokepoint-fill')).toBe(true)
      expect(facade.layerIds.has('chokepoint-stroke')).toBe(true)
    })

    it('does not hide the core signal layers during init when showSignals is true', async () => {
      const containerRef = makeContainerRef()
      await bootMap(facade, containerRef, defaultInput(containerRef, { showSignals: true }))

      // Visibility defaults to 'visible' on init for the interactive signal layers.
      // The dedicated heatmap overlay is allowed to initialize hidden because it is
      // a separate optional density view, not part of the default symbol stack.
      const hideCalls = facade.calls.filter(
        c => c.method === 'setLayoutProperty' &&
             c.args[1] === 'visibility' &&
             c.args[2] === 'none' &&
             String(c.args[0]).startsWith('signal') &&
             c.args[0] !== 'signal-heatmap',
      )
      expect(hideCalls).toHaveLength(0)
    })
  })

  // ── Style switching ───────────────────────────────────────────────────────
  //
  // MapLibre wipes all sources and layers when setStyle is called.
  // The hook must:
  //   1. Synchronously clear mapLoaded before calling setStyle
  //   2. Re-raise mapLoaded after style.load fires
  //   3. Re-add all layers on the new style

  describe('style switching', () => {
    it('calls setStyle when mapStyle prop changes', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef, { mapStyle: 'tactical' }))

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { mapStyle: 'satellite' }))
        await Promise.resolve()
      })

      expect(facade.calls.some(c => c.method === 'setStyle')).toBe(true)
    })

    it('drops mapLoaded to false immediately when style switches, before style.load fires', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef, { mapStyle: 'tactical' }))

      expect(hook.result.current.mapLoaded).toBe(true)

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { mapStyle: 'satellite' }))
        await Promise.resolve()
      })

      // Must be false until style.load is acknowledged — prevents effects from
      // firing against a stale style context
      expect(hook.result.current.mapLoaded).toBe(false)
    })

    it('recovers mapLoaded=true after style.load fires following a style switch', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef))

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { mapStyle: 'satellite' }))
        await Promise.resolve()
      })

      expect(hook.result.current.mapLoaded).toBe(false)

      await act(async () => {
        facade.fire('style.load')
      })

      expect(hook.result.current.mapLoaded).toBe(true)
    })

    it('re-adds site and signal layers after style switch completes', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef))

      expect(facade.layerIds.has('site-circles')).toBe(true)
      expect(facade.layerIds.has('signal-circles')).toBe(true)

      // Style switch clears the layer registry (mirrors MapLibre's behaviour)
      await act(async () => {
        hook.rerender(defaultInput(containerRef, { mapStyle: 'satellite' }))
        await Promise.resolve()
      })

      expect(facade.layerIds.has('site-circles')).toBe(false)
      expect(facade.layerIds.has('signal-circles')).toBe(false)

      // After style.load all mapLoaded-gated effects re-run and layers are re-registered
      await act(async () => {
        facade.fire('style.load')
        await Promise.resolve()
      })

      expect(facade.layerIds.has('site-circles')).toBe(true)
      expect(facade.layerIds.has('signal-circles')).toBe(true)
      expect(facade.layerIds.has('sensor-coverage-fill')).toBe(true)
    })
  })

  // ── Selection ring filters ─────────────────────────────────────────────────
  //
  // Each selection change must call setFilter with a precise MapLibre
  // expression — ['==', ['get', 'id'], <id>] — so the ring highlights
  // exactly one feature.  Deselection resets to '' (no feature matches '').

  describe('selection ring filters', () => {
    it('sets the site selection ring filter when selectedSiteId changes', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef))

      facade.calls.length = 0 // discard init calls

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { selectedSiteId: 'site-abc' }))
      })

      const call = facade.calls.find(
        c => c.method === 'setFilter' && c.args[0] === 'site-selection-ring',
      )
      expect(call).toBeDefined()
      expect(call?.args[1]).toEqual(['==', ['get', 'id'], 'site-abc'])
    })

    it('resets the site selection ring filter to empty string on deselect', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(
        facade, containerRef,
        defaultInput(containerRef, { selectedSiteId: 'site-abc' }),
      )

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { selectedSiteId: null }))
      })

      const call = facade.calls.find(
        c => c.method === 'setFilter' && c.args[0] === 'site-selection-ring',
      )
      expect(call?.args[1]).toEqual(['==', ['get', 'id'], ''])
    })

    it('sets the asset selection ring filter when selectedAssetId changes', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef))

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { selectedAssetId: 'asset-xyz' }))
      })

      const call = facade.calls.find(
        c => c.method === 'setFilter' && c.args[0] === 'asset-selection-ring',
      )
      expect(call).toBeDefined()
      expect(call?.args[1]).toEqual(['==', ['get', 'id'], 'asset-xyz'])
    })
  })

  describe('measurement mode', () => {
    it('creates measurement layers on init', async () => {
      const containerRef = makeContainerRef()
      await bootMap(facade, containerRef, defaultInput(containerRef))

      expect(facade.layerIds.has('measurement-line')).toBe(true)
      expect(facade.layerIds.has('measurement-points')).toBe(true)
      expect(facade.layerIds.has('measurement-point-labels')).toBe(true)
    })

    it('adds measurement layers after the signal stack so measurements stay visible over dense signals', async () => {
      const containerRef = makeContainerRef()
      await bootMap(facade, containerRef, defaultInput(containerRef))

      const addedLayerIds = facade.calls
        .filter(call => call.method === 'addLayer')
        .map(call => String(call.args[0]))

      expect(addedLayerIds.indexOf('measurement-line')).toBeGreaterThan(addedLayerIds.indexOf('signal-symbols'))
      expect(addedLayerIds.indexOf('measurement-points')).toBeGreaterThan(addedLayerIds.indexOf('selected-signal-symbol'))
      expect(addedLayerIds.indexOf('measurement-point-labels')).toBeGreaterThan(addedLayerIds.indexOf('selected-signal-symbol'))
    })

    it('updates measurement sources when measurement points change', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef))

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, {
          measurementPoints: [
            { lat: 37.7749, lng: -122.4194 },
            { lat: 34.0522, lng: -118.2437 },
          ],
        }))
      })

      expect(facade.calls).toContainEqual({
        method: 'setData',
        args: [
          'measurement-points',
          expect.objectContaining({
            type: 'FeatureCollection',
            features: [
              expect.objectContaining({
                properties: expect.objectContaining({ label: 'A', role: 'anchor' }),
              }),
              expect.objectContaining({
                properties: expect.objectContaining({ label: 'B', role: 'target' }),
              }),
            ],
          }),
        ],
      })

      expect(facade.calls).toContainEqual({
        method: 'setData',
        args: [
          'measurement-line',
          expect.objectContaining({
            type: 'FeatureCollection',
            features: [
              expect.objectContaining({
                geometry: expect.objectContaining({
                  type: 'LineString',
                  coordinates: [
                    [-122.4194, 37.7749],
                    [-118.2437, 34.0522],
                  ],
                }),
              }),
            ],
          }),
        ],
      })
    })

    it('routes map clicks to measurement capture instead of selection when measurement mode is active', async () => {
      const onMapCoordinateClick = vi.fn()
      const onSiteClick = vi.fn()
      const containerRef = makeContainerRef()

      await bootMap(facade, containerRef, defaultInput(containerRef, {
        measurementMode: true,
        onMapCoordinateClick,
        onSiteClick,
      }))

      facade.setQueryRenderedFeaturesResult([{
        layer: { id: 'site-circles' },
        properties: { id: 'site-1' },
      }])

      await act(async () => {
        facade.fire('click', {
          point: { x: 40, y: 60 },
          lngLat: { lng: -122.4194, lat: 37.7749 },
        })
      })

      expect(onMapCoordinateClick).toHaveBeenCalledWith({ lng: -122.4194, lat: 37.7749 })
      expect(onSiteClick).not.toHaveBeenCalled()
    })
  })

  describe('annotation mode', () => {
    it('creates annotation layers on init and updates the annotation source when pins change', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef))

      expect(facade.layerIds.has('map-annotation-points')).toBe(true)
      expect(facade.layerIds.has('map-annotation-labels')).toBe(true)

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, {
          annotations: [
            { id: 'annotation-1', label: 'Ingress', lat: 37.7749, lng: -122.4194 },
            { id: 'annotation-2', label: 'Fallback', lat: 34.0522, lng: -118.2437 },
          ],
        }))
      })

      expect(facade.calls).toContainEqual({
        method: 'setData',
        args: [
          'map-annotations',
          expect.objectContaining({
            type: 'FeatureCollection',
            features: [
              expect.objectContaining({
                properties: expect.objectContaining({ id: 'annotation-1', label: 'Ingress' }),
              }),
              expect.objectContaining({
                properties: expect.objectContaining({ id: 'annotation-2', label: 'Fallback' }),
              }),
            ],
          }),
        ],
      })
    })

    it('adds annotation layers after the signal stack so annotations stay visible over dense signals', async () => {
      const containerRef = makeContainerRef()
      await bootMap(facade, containerRef, defaultInput(containerRef))

      const addedLayerIds = facade.calls
        .filter(call => call.method === 'addLayer')
        .map(call => String(call.args[0]))

      expect(addedLayerIds.indexOf('map-annotation-points')).toBeGreaterThan(addedLayerIds.indexOf('signal-symbols'))
      expect(addedLayerIds.indexOf('map-annotation-labels')).toBeGreaterThan(addedLayerIds.indexOf('selected-signal-symbol'))
    })

    it('routes map clicks to annotation capture instead of selection when annotation mode is active', async () => {
      const onMapAnnotationClick = vi.fn()
      const onSiteClick = vi.fn()
      const containerRef = makeContainerRef()

      await bootMap(facade, containerRef, defaultInput(containerRef, {
        annotationMode: true,
        onMapAnnotationClick,
        onSiteClick,
      }))

      facade.setQueryRenderedFeaturesResult([{
        layer: { id: 'site-circles' },
        properties: { id: 'site-1' },
      }])

      await act(async () => {
        facade.fire('click', {
          point: { x: 40, y: 60 },
          lngLat: { lng: -122.4194, lat: 37.7749 },
        })
      })

      expect(onMapAnnotationClick).toHaveBeenCalledWith({ lng: -122.4194, lat: 37.7749 })
      expect(onSiteClick).not.toHaveBeenCalled()
    })

    it('re-adds annotation layers and reseeds existing pins after a style swap', async () => {
      const containerRef = makeContainerRef()
      const annotations = [
        { id: 'annotation-1', label: 'Ingress', lat: 37.7749, lng: -122.4194 },
      ]
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef, { annotations }))

      expect(facade.layerIds.has('map-annotation-points')).toBe(true)
      expect(facade.layerIds.has('map-annotation-labels')).toBe(true)

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { mapStyle: 'satellite', annotations }))
        await Promise.resolve()
      })

      await act(async () => {
        facade.fire('style.load')
        await Promise.resolve()
      })

      expect(facade.layerIds.has('map-annotation-points')).toBe(true)
      expect(facade.layerIds.has('map-annotation-labels')).toBe(true)

      const annotationAddSourceCalls = facade.calls
        .filter(call => call.method === 'addSource' && call.args[0] === 'map-annotations')
      expect(annotationAddSourceCalls.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('range ring mode', () => {
    it('creates range-ring layers on init and updates range-ring sources when anchor data changes', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef))

      expect(facade.layerIds.has('map-range-rings')).toBe(true)
      expect(facade.layerIds.has('map-range-ring-anchor')).toBe(true)
      expect(facade.layerIds.has('map-range-ring-labels')).toBe(true)

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, {
          rangeRingAnchor: { lat: 37.7749, lng: -122.4194 },
          rangeRingRadiiKm: [9.26, 18.52],
          rangeRingUnit: 'nm',
        }))
      })

      expect(facade.calls).toContainEqual({
        method: 'setData',
        args: [
          'map-range-rings',
          expect.objectContaining({
            type: 'FeatureCollection',
            features: expect.arrayContaining([
              expect.objectContaining({
                geometry: expect.objectContaining({ type: 'LineString' }),
              }),
            ]),
          }),
        ],
      })
      expect(facade.calls).toContainEqual({
        method: 'setData',
        args: [
          'map-range-ring-labels',
          expect.objectContaining({
            type: 'FeatureCollection',
            features: expect.arrayContaining([
              expect.objectContaining({
                properties: expect.objectContaining({ label: '5 NM' }),
              }),
            ]),
          }),
        ],
      })
    })

    it('adds range-ring layers after the signal stack but before annotations and measurement', async () => {
      const containerRef = makeContainerRef()
      await bootMap(facade, containerRef, defaultInput(containerRef))

      const addedLayerIds = facade.calls
        .filter(call => call.method === 'addLayer')
        .map(call => String(call.args[0]))

      expect(addedLayerIds.indexOf('map-range-rings')).toBeGreaterThan(addedLayerIds.indexOf('signal-symbols'))
      expect(addedLayerIds.indexOf('map-range-ring-anchor')).toBeGreaterThan(addedLayerIds.indexOf('selected-signal-symbol'))
      expect(addedLayerIds.indexOf('map-range-rings')).toBeLessThan(addedLayerIds.indexOf('map-annotation-points'))
      expect(addedLayerIds.indexOf('map-range-rings')).toBeLessThan(addedLayerIds.indexOf('measurement-line'))
    })

    it('routes map clicks to range-ring anchor capture instead of selection when range-ring mode is active', async () => {
      const onMapRangeRingAnchorClick = vi.fn()
      const onSiteClick = vi.fn()
      const containerRef = makeContainerRef()

      await bootMap(facade, containerRef, defaultInput(containerRef, {
        rangeRingMode: true,
        onMapRangeRingAnchorClick,
        onSiteClick,
      }))

      facade.setQueryRenderedFeaturesResult([{
        layer: { id: 'site-circles' },
        properties: { id: 'site-1' },
      }])

      await act(async () => {
        facade.fire('click', {
          point: { x: 40, y: 60 },
          lngLat: { lng: -122.4194, lat: 37.7749 },
        })
      })

      expect(onMapRangeRingAnchorClick).toHaveBeenCalledWith({ lng: -122.4194, lat: 37.7749 })
      expect(onSiteClick).not.toHaveBeenCalled()
    })

    it('re-adds range-ring layers and reseeds the current anchor after a style swap', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef, {
        rangeRingAnchor: { lat: 37.7749, lng: -122.4194 },
        rangeRingRadiiKm: [9.26, 18.52, 37.04],
        rangeRingUnit: 'nm',
      }))

      expect(facade.layerIds.has('map-range-rings')).toBe(true)
      expect(facade.layerIds.has('map-range-ring-labels')).toBe(true)

      await act(async () => {
        hook.rerender(defaultInput(containerRef, {
          mapStyle: 'satellite',
          rangeRingAnchor: { lat: 37.7749, lng: -122.4194 },
          rangeRingRadiiKm: [9.26, 18.52, 37.04],
          rangeRingUnit: 'nm',
        }))
        await Promise.resolve()
      })

      await act(async () => {
        facade.fire('style.load')
        await Promise.resolve()
      })

      expect(facade.layerIds.has('map-range-rings')).toBe(true)
      expect(facade.layerIds.has('map-range-ring-labels')).toBe(true)

      const rangeRingAddSourceCalls = facade.calls
        .filter(call => call.method === 'addSource' && call.args[0] === 'map-range-rings')
      expect(rangeRingAddSourceCalls.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('bearing line mode', () => {
    it('creates bearing-line layers on init and updates sources when anchor data changes', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef))

      expect(facade.layerIds.has('map-bearing-line')).toBe(true)
      expect(facade.layerIds.has('map-bearing-points')).toBe(true)
      expect(facade.layerIds.has('map-bearing-labels')).toBe(true)

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, {
          bearingLineAnchor: { lat: 37.7749, lng: -122.4194 },
          bearingLineDegrees: 120,
          bearingLineDistanceKm: 22.224,
          bearingLineUnit: 'nm',
        }))
      })

      expect(facade.calls).toContainEqual({
        method: 'setData',
        args: [
          'map-bearing-line',
          expect.objectContaining({
            type: 'FeatureCollection',
            features: expect.arrayContaining([
              expect.objectContaining({
                geometry: expect.objectContaining({ type: 'LineString' }),
              }),
            ]),
          }),
        ],
      })
      expect(facade.calls).toContainEqual({
        method: 'setData',
        args: [
          'map-bearing-labels',
          expect.objectContaining({
            type: 'FeatureCollection',
            features: expect.arrayContaining([
              expect.objectContaining({
                properties: expect.objectContaining({ label: '120° · 12 NM' }),
              }),
            ]),
          }),
        ],
      })
    })

    it('adds bearing-line layers after range rings but before annotations and measurement', async () => {
      const containerRef = makeContainerRef()
      await bootMap(facade, containerRef, defaultInput(containerRef))

      const addedLayerIds = facade.calls
        .filter(call => call.method === 'addLayer')
        .map(call => String(call.args[0]))

      expect(addedLayerIds.indexOf('map-bearing-line')).toBeGreaterThan(addedLayerIds.indexOf('signal-symbols'))
      expect(addedLayerIds.indexOf('map-bearing-line')).toBeGreaterThan(addedLayerIds.indexOf('map-range-rings'))
      expect(addedLayerIds.indexOf('map-bearing-line')).toBeLessThan(addedLayerIds.indexOf('map-annotation-points'))
      expect(addedLayerIds.indexOf('map-bearing-line')).toBeLessThan(addedLayerIds.indexOf('measurement-line'))
    })

    it('routes map clicks to bearing-line anchor capture instead of selection when bearing-line mode is active', async () => {
      const onMapBearingLineAnchorClick = vi.fn()
      const onSiteClick = vi.fn()
      const containerRef = makeContainerRef()

      await bootMap(facade, containerRef, defaultInput(containerRef, {
        bearingLineMode: true,
        onMapBearingLineAnchorClick,
        onSiteClick,
      }))

      facade.setQueryRenderedFeaturesResult([{
        layer: { id: 'site-circles' },
        properties: { id: 'site-1' },
      }])

      await act(async () => {
        facade.fire('click', {
          point: { x: 40, y: 60 },
          lngLat: { lng: -122.4194, lat: 37.7749 },
        })
      })

      expect(onMapBearingLineAnchorClick).toHaveBeenCalledWith({ lng: -122.4194, lat: 37.7749 })
      expect(onSiteClick).not.toHaveBeenCalled()
    })

    it('re-adds bearing-line layers and reseeds the current anchor after a style swap', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef, {
        bearingLineAnchor: { lat: 37.7749, lng: -122.4194 },
        bearingLineDegrees: 75,
        bearingLineDistanceKm: 18.52,
        bearingLineUnit: 'nm',
      }))

      expect(facade.layerIds.has('map-bearing-line')).toBe(true)
      expect(facade.layerIds.has('map-bearing-labels')).toBe(true)

      await act(async () => {
        hook.rerender(defaultInput(containerRef, {
          mapStyle: 'satellite',
          bearingLineAnchor: { lat: 37.7749, lng: -122.4194 },
          bearingLineDegrees: 75,
          bearingLineDistanceKm: 18.52,
          bearingLineUnit: 'nm',
        }))
        await Promise.resolve()
      })

      await act(async () => {
        facade.fire('style.load')
        await Promise.resolve()
      })

      expect(facade.layerIds.has('map-bearing-line')).toBe(true)
      expect(facade.layerIds.has('map-bearing-labels')).toBe(true)

      const bearingLineAddSourceCalls = facade.calls
        .filter(call => call.method === 'addSource' && call.args[0] === 'map-bearing-line')
      expect(bearingLineAddSourceCalls.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('sector mode', () => {
    it('creates sector layers on init and updates sources when anchor data changes', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef))

      expect(facade.layerIds.has('map-sector-fill')).toBe(true)
      expect(facade.layerIds.has('map-sector-outline')).toBe(true)
      expect(facade.layerIds.has('map-sector-labels')).toBe(true)

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, {
          sectorAnchor: { lat: 37.7749, lng: -122.4194 },
          sectorDegrees: 75,
          sectorArcDegrees: 60,
          sectorDistanceKm: 18.52,
          sectorUnit: 'nm',
        }))
      })

      expect(facade.calls).toContainEqual({
        method: 'setData',
        args: [
          'map-sector-fill',
          expect.objectContaining({
            type: 'FeatureCollection',
            features: expect.arrayContaining([
              expect.objectContaining({
                geometry: expect.objectContaining({ type: 'Polygon' }),
              }),
            ]),
          }),
        ],
      })
      expect(facade.calls).toContainEqual({
        method: 'setData',
        args: [
          'map-sector-labels',
          expect.objectContaining({
            type: 'FeatureCollection',
            features: expect.arrayContaining([
              expect.objectContaining({
                properties: expect.objectContaining({ label: '075° · 60° ARC · 10 NM' }),
              }),
            ]),
          }),
        ],
      })
    })

    it('adds sector layers after range rings but before bearing lines, annotations, and measurement', async () => {
      const containerRef = makeContainerRef()
      await bootMap(facade, containerRef, defaultInput(containerRef))

      const addedLayerIds = facade.calls
        .filter(call => call.method === 'addLayer')
        .map(call => String(call.args[0]))

      expect(addedLayerIds.indexOf('map-sector-fill')).toBeGreaterThan(addedLayerIds.indexOf('map-range-rings'))
      expect(addedLayerIds.indexOf('map-sector-fill')).toBeLessThan(addedLayerIds.indexOf('map-bearing-line'))
      expect(addedLayerIds.indexOf('map-sector-fill')).toBeLessThan(addedLayerIds.indexOf('map-annotation-points'))
      expect(addedLayerIds.indexOf('map-sector-fill')).toBeLessThan(addedLayerIds.indexOf('measurement-line'))
    })

    it('routes map clicks to sector anchor capture instead of selection when sector mode is active', async () => {
      const onMapSectorAnchorClick = vi.fn()
      const onSiteClick = vi.fn()
      const containerRef = makeContainerRef()

      await bootMap(facade, containerRef, defaultInput(containerRef, {
        sectorMode: true,
        onMapSectorAnchorClick,
        onSiteClick,
      }))

      facade.setQueryRenderedFeaturesResult([{
        layer: { id: 'site-circles' },
        properties: { id: 'site-1' },
      }])

      await act(async () => {
        facade.fire('click', {
          point: { x: 40, y: 60 },
          lngLat: { lng: -122.4194, lat: 37.7749 },
        })
      })

      expect(onMapSectorAnchorClick).toHaveBeenCalledWith({ lng: -122.4194, lat: 37.7749 })
      expect(onSiteClick).not.toHaveBeenCalled()
    })

    it('re-adds sector layers and reseeds the current anchor after a style swap', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef, {
        sectorAnchor: { lat: 37.7749, lng: -122.4194 },
        sectorDegrees: 45,
        sectorArcDegrees: 70,
        sectorDistanceKm: 22.224,
        sectorUnit: 'nm',
      }))

      expect(facade.layerIds.has('map-sector-fill')).toBe(true)
      expect(facade.layerIds.has('map-sector-labels')).toBe(true)

      await act(async () => {
        hook.rerender(defaultInput(containerRef, {
          mapStyle: 'satellite',
          sectorAnchor: { lat: 37.7749, lng: -122.4194 },
          sectorDegrees: 45,
          sectorArcDegrees: 70,
          sectorDistanceKm: 22.224,
          sectorUnit: 'nm',
        }))
        await Promise.resolve()
      })

      await act(async () => {
        facade.fire('style.load')
        await Promise.resolve()
      })

      expect(facade.layerIds.has('map-sector-fill')).toBe(true)
      expect(facade.layerIds.has('map-sector-labels')).toBe(true)

      const sectorAddSourceCalls = facade.calls
        .filter(call => call.method === 'addSource' && call.args[0] === 'map-sector-fill')
      expect(sectorAddSourceCalls.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ── Cross-entity linked ring filters ──────────────────────────────────────
  //
  // When an asset is selected, its home site should get a linked ring.
  // When a site is selected, all assets at that site should get a linked ring.

  describe('cross-entity linked ring filters', () => {
    it('creates site-linked-ring and asset-linked-ring layers on init', async () => {
      const containerRef = makeContainerRef()
      await bootMap(facade, containerRef, defaultInput(containerRef))

      expect(facade.layerIds.has('site-linked-ring')).toBe(true)
      expect(facade.layerIds.has('asset-linked-ring')).toBe(true)
    })

    it('highlights the home site when an asset with home_site_id is selected', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef, {
        assets: [{
          id: 'asset-1',
          name: 'Asset One',
          asset_type: 'vehicle',
          status: 'available',
          home_site_id: 'site-home',
          last_reported_at: '2026-03-26T11:00:00.000Z',
          created_at: '2026-03-24T00:00:00.000Z',
          updated_at: '2026-03-24T00:00:00.000Z',
        }],
      }))

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, {
          assets: [{
            id: 'asset-1',
            name: 'Asset One',
            asset_type: 'vehicle',
            status: 'available',
            home_site_id: 'site-home',
            last_reported_at: '2026-03-26T11:00:00.000Z',
            created_at: '2026-03-24T00:00:00.000Z',
            updated_at: '2026-03-24T00:00:00.000Z',
          }],
          selectedAssetId: 'asset-1',
        }))
      })

      const call = facade.calls.find(
        c => c.method === 'setFilter' && c.args[0] === 'site-linked-ring',
      )
      expect(call).toBeDefined()
      expect(call?.args[1]).toEqual(['==', ['get', 'id'], 'site-home'])
    })

    it('highlights assets at a site when that site is selected', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef))

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { selectedSiteId: 'site-abc' }))
      })

      const call = facade.calls.find(
        c => c.method === 'setFilter' && c.args[0] === 'asset-linked-ring',
      )
      expect(call).toBeDefined()
      expect(call?.args[1]).toEqual(['==', ['get', 'home_site_id'], 'site-abc'])
    })

    it('resets linked rings to empty string on deselect', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef, {
        assets: [{
          id: 'asset-1',
          name: 'Asset One',
          asset_type: 'vehicle',
          status: 'available',
          home_site_id: 'site-home',
          last_reported_at: '2026-03-26T11:00:00.000Z',
          created_at: '2026-03-24T00:00:00.000Z',
          updated_at: '2026-03-24T00:00:00.000Z',
        }],
        selectedAssetId: 'asset-1',
        selectedSiteId: 'site-abc',
      }))

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, {
          assets: [{
            id: 'asset-1',
            name: 'Asset One',
            asset_type: 'vehicle',
            status: 'available',
            home_site_id: 'site-home',
            last_reported_at: '2026-03-26T11:00:00.000Z',
            created_at: '2026-03-24T00:00:00.000Z',
            updated_at: '2026-03-24T00:00:00.000Z',
          }],
          selectedAssetId: null,
          selectedSiteId: null,
        }))
      })

      const siteLinkedCall = facade.calls.find(
        c => c.method === 'setFilter' && c.args[0] === 'site-linked-ring',
      )
      const assetLinkedCall = facade.calls.find(
        c => c.method === 'setFilter' && c.args[0] === 'asset-linked-ring',
      )
      expect(siteLinkedCall?.args[1]).toEqual(['==', ['get', 'id'], ''])
      expect(assetLinkedCall?.args[1]).toEqual(['==', ['get', 'home_site_id'], ''])
    })

    it('re-creates linked ring layers after style switch', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef))

      expect(facade.layerIds.has('site-linked-ring')).toBe(true)
      expect(facade.layerIds.has('asset-linked-ring')).toBe(true)

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { mapStyle: 'satellite' }))
        await Promise.resolve()
      })

      expect(facade.layerIds.has('site-linked-ring')).toBe(false)
      expect(facade.layerIds.has('asset-linked-ring')).toBe(false)

      await act(async () => {
        facade.fire('style.load')
        await Promise.resolve()
      })

      expect(facade.layerIds.has('site-linked-ring')).toBe(true)
      expect(facade.layerIds.has('asset-linked-ring')).toBe(true)
    })
  })

  describe('evidence-linked highlighting', () => {
    it('creates site-evidence-ring and signal-evidence-ring layers on init', async () => {
      const containerRef = makeContainerRef()
      await bootMap(facade, containerRef, defaultInput(containerRef))

      expect(facade.layerIds.has('site-evidence-ring')).toBe(true)
      expect(facade.layerIds.has('signal-evidence-ring')).toBe(true)
    })

    it('updates site-evidence-ring filter when evidenceSiteIds change', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef))

      await act(async () => {
        hook.rerender(defaultInput(containerRef, {
          evidenceSiteIds: ['site-a', 'site-b'],
        }))
        await Promise.resolve()
      })

      const filterCall = facade.calls.filter(
        c => c.method === 'setFilter' && c.args[0] === 'site-evidence-ring',
      ).pop()
      expect(filterCall).toBeDefined()
      expect(filterCall!.args[1]).toEqual(
        ['in', ['get', 'id'], ['literal', ['site-a', 'site-b']]],
      )
    })

    it('updates signal-evidence-ring filter when evidenceSignalIds change', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef))

      await act(async () => {
        hook.rerender(defaultInput(containerRef, {
          evidenceSignalIds: ['sig-1', 'sig-2'],
        }))
        await Promise.resolve()
      })

      const filterCall = facade.calls.filter(
        c => c.method === 'setFilter' && c.args[0] === 'signal-evidence-ring',
      ).pop()
      expect(filterCall).toBeDefined()
      expect(filterCall!.args[1]).toEqual(
        ['all', ['!', ['has', 'point_count']], ['in', ['get', 'id'], ['literal', ['sig-1', 'sig-2']]]],
      )
    })

    it('clears evidence filters when IDs become empty', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(facade, containerRef, defaultInput(containerRef, {
        evidenceSiteIds: ['site-a'],
        evidenceSignalIds: ['sig-1'],
      }))

      await act(async () => {
        hook.rerender(defaultInput(containerRef, {
          evidenceSiteIds: [],
          evidenceSignalIds: [],
        }))
        await Promise.resolve()
      })

      const siteFilter = facade.calls.filter(
        c => c.method === 'setFilter' && c.args[0] === 'site-evidence-ring',
      ).pop()
      expect(siteFilter!.args[1]).toEqual(
        ['in', ['get', 'id'], ['literal', []]],
      )

      const signalFilter = facade.calls.filter(
        c => c.method === 'setFilter' && c.args[0] === 'signal-evidence-ring',
      ).pop()
      expect(signalFilter!.args[1]).toEqual(
        ['all', ['!', ['has', 'point_count']], ['in', ['get', 'id'], ['literal', []]]],
      )
    })
  })

  describe('asset freshness rendering', () => {
    it('encodes asset freshness on source data using the shared reference time', async () => {
      const containerRef = makeContainerRef()

      await bootMap(
        facade,
        containerRef,
        defaultInput(containerRef, {
          assets: [{
            id: 'asset-1',
            name: 'Asset One',
            asset_type: 'vehicle',
            status: 'available',
            home_site_id: null,
            last_reported_at: '2026-03-26T02:00:00.000Z',
            created_at: '2026-03-24T00:00:00.000Z',
            updated_at: '2026-03-24T00:00:00.000Z',
          }],
          referenceTimeMs: Date.parse('2026-03-26T12:00:00.000Z'),
        }),
      )

      expect(facade.calls).toContainEqual({
        method: 'setData',
        args: [
          'asset-points',
          expect.objectContaining({
            type: 'FeatureCollection',
            features: [
              expect.objectContaining({
                properties: expect.objectContaining({
                  id: 'asset-1',
                  freshness: 'aging',
                }),
              }),
            ],
          }),
        ],
      })
    })

    it('maps asset freshness into circle and symbol opacity', async () => {
      const containerRef = makeContainerRef()

      await bootMap(facade, containerRef, defaultInput(containerRef))

      const assetCirclesLayer = facade.calls.find(
        c => c.method === 'addLayer' && c.args[0] === 'asset-circles',
      )?.args[1] as { paint?: Record<string, unknown> } | undefined

      const assetSymbolsLayer = facade.calls.find(
        c => c.method === 'addLayer' && c.args[0] === 'asset-symbols',
      )?.args[1] as { paint?: Record<string, unknown> } | undefined

      expect(assetCirclesLayer?.paint?.['circle-opacity']).toEqual([
        'match', ['get', 'freshness'],
        'fresh', 0.94,
        'aging', 0.72,
        'stale', 0.46,
        'unavailable', 0.32,
        0.94,
      ])
      expect(assetCirclesLayer?.paint?.['circle-stroke-opacity']).toEqual([
        'match', ['get', 'freshness'],
        'fresh', 1,
        'aging', 0.8,
        'stale', 0.58,
        'unavailable', 0.42,
        1,
      ])
      expect(assetSymbolsLayer?.paint?.['text-opacity']).toEqual([
        'match', ['get', 'freshness'],
        'fresh', 1,
        'aging', 0.78,
        'stale', 0.54,
        'unavailable', 0.4,
        1,
      ])
    })
  })

  // ── Signal layer visibility toggle ────────────────────────────────────────
  //
  // All 9 signal layer IDs must receive a visibility update.
  // Hiding signals must also call onSignalClick(null) to clear stale
  // selection state — if it doesn't, the inspector panel stays open
  // after the layers are hidden.

  describe('signal visibility toggle', () => {
    const SIGNAL_LAYER_IDS = [
      'signal-clusters',
      'signal-cluster-count',
      'signal-glow',
      'signal-circles',
      'signal-symbols',
      'selected-signal-ring',
      'selected-signal-glow',
      'selected-signal-circle',
      'selected-signal-symbol',
    ] as const

    it('sets all 9 signal layers to visibility=none when showSignals becomes false', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(
        facade, containerRef,
        defaultInput(containerRef, { showSignals: true }),
      )

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { showSignals: false }))
      })

      const hiddenIds = facade.calls
        .filter(c =>
          c.method === 'setLayoutProperty' &&
          c.args[1] === 'visibility' &&
          c.args[2] === 'none',
        )
        .map(c => c.args[0] as string)

      for (const layerId of SIGNAL_LAYER_IDS) {
        expect(hiddenIds).toContain(layerId)
      }
    })

    it('calls onSignalClick(null) when showSignals becomes false', async () => {
      const onSignalClick = vi.fn()
      const containerRef = makeContainerRef()
      const hook = await bootMap(
        facade, containerRef,
        defaultInput(containerRef, { showSignals: true, onSignalClick }),
      )

      onSignalClick.mockClear()

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { showSignals: false, onSignalClick }))
      })

      expect(onSignalClick).toHaveBeenCalledWith(null)
    })

    it('does not call onSignalClick when signals are shown', async () => {
      const onSignalClick = vi.fn()
      const containerRef = makeContainerRef()
      const hook = await bootMap(
        facade, containerRef,
        defaultInput(containerRef, { showSignals: false, onSignalClick }),
      )

      onSignalClick.mockClear()

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { showSignals: true, onSignalClick }))
      })

      expect(onSignalClick).not.toHaveBeenCalled()
    })

    it('sets all 9 signal layers to visibility=visible when showSignals becomes true', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(
        facade, containerRef,
        defaultInput(containerRef, { showSignals: false }),
      )

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { showSignals: true }))
      })

      const shownIds = facade.calls
        .filter(c =>
          c.method === 'setLayoutProperty' &&
          c.args[1] === 'visibility' &&
          c.args[2] === 'visible',
        )
        .map(c => c.args[0] as string)

      for (const layerId of SIGNAL_LAYER_IDS) {
        expect(shownIds).toContain(layerId)
      }
    })
  })

  // ── Coverage layer visibility toggle ──────────────────────────────────────
  //
  // Coverage layers are added on first mapLoaded regardless of whether
  // coverageCircles is populated.  The visibility effect gates on
  // getLayer('sensor-coverage-fill') — so the layer must exist first.

  describe('coverage visibility toggle', () => {
    it('hides coverage fill and stroke when showCoverage becomes false', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(
        facade, containerRef,
        defaultInput(containerRef, { showCoverage: true }),
      )

      // Coverage layers are always added after mapLoaded (even with empty circles)
      expect(facade.layerIds.has('sensor-coverage-fill')).toBe(true)

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { showCoverage: false }))
      })

      const hiddenIds = facade.calls
        .filter(c =>
          c.method === 'setLayoutProperty' &&
          c.args[1] === 'visibility' &&
          c.args[2] === 'none',
        )
        .map(c => c.args[0] as string)

      expect(hiddenIds).toContain('sensor-coverage-fill')
      expect(hiddenIds).toContain('sensor-coverage-stroke')
    })

    it('shows coverage layers when showCoverage becomes true', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(
        facade, containerRef,
        defaultInput(containerRef, { showCoverage: false }),
      )

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { showCoverage: true }))
      })

      const shownIds = facade.calls
        .filter(c =>
          c.method === 'setLayoutProperty' &&
          c.args[1] === 'visibility' &&
          c.args[2] === 'visible',
        )
        .map(c => c.args[0] as string)

      expect(shownIds).toContain('sensor-coverage-fill')
    })
  })

  describe('chokepoint overlay lifecycle', () => {
    const chokepoint = {
      id: 'cp-1',
      name: 'Narrows',
      status: 'monitor' as const,
      category: 'strait' as const,
      latitude: 12,
      longitude: 22,
      watch_radius_km: 40,
      area_of_operation_id: 'ao-1',
      area_of_operation_name: 'AO One',
      notes: null,
      created_by_id: 'user-1',
      updated_by_id: 'user-1',
      created_at: '2026-03-26T00:00:00Z',
      updated_at: '2026-03-26T00:00:00Z',
    }

    it('hides chokepoint fill and stroke when showChokepoints becomes false', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(
        facade,
        containerRef,
        defaultInput(containerRef, { chokepoints: [chokepoint], showChokepoints: true }),
      )

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { chokepoints: [chokepoint], showChokepoints: false }))
      })

      const hiddenIds = facade.calls
        .filter(c =>
          c.method === 'setLayoutProperty' &&
          c.args[1] === 'visibility' &&
          c.args[2] === 'none',
        )
        .map(c => c.args[0] as string)

      expect(hiddenIds).toContain('chokepoint-fill')
      expect(hiddenIds).toContain('chokepoint-stroke')
    })

    it('shows chokepoint fill and stroke when showChokepoints becomes true', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(
        facade,
        containerRef,
        defaultInput(containerRef, { chokepoints: [chokepoint], showChokepoints: false }),
      )

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { chokepoints: [chokepoint], showChokepoints: true }))
      })

      const shownIds = facade.calls
        .filter(c =>
          c.method === 'setLayoutProperty' &&
          c.args[1] === 'visibility' &&
          c.args[2] === 'visible',
        )
        .map(c => c.args[0] as string)

      expect(shownIds).toContain('chokepoint-fill')
      expect(shownIds).toContain('chokepoint-stroke')
    })

    it('empties the chokepoint source when the data set becomes empty', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(
        facade,
        containerRef,
        defaultInput(containerRef, { chokepoints: [chokepoint] }),
      )

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { chokepoints: [] }))
      })

      expect(facade.calls).toContainEqual({
        method: 'setData',
        args: [
          'chokepoint-circles',
          {
            type: 'FeatureCollection',
            features: [],
          },
        ],
      })
    })
  })

  describe('heatmap visibility toggle', () => {
    it('hides the heatmap layer when showHeatmap becomes false', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(
        facade, containerRef,
        defaultInput(containerRef, { showHeatmap: true }),
      )

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { showHeatmap: false }))
      })

      expect(facade.calls).toContainEqual({
        method: 'setLayoutProperty',
        args: ['signal-heatmap', 'visibility', 'none'],
      })
    })

    it('shows the heatmap layer when showHeatmap becomes true', async () => {
      const containerRef = makeContainerRef()
      const hook = await bootMap(
        facade, containerRef,
        defaultInput(containerRef, { showHeatmap: false }),
      )

      facade.calls.length = 0

      await act(async () => {
        hook.rerender(defaultInput(containerRef, { showHeatmap: true }))
      })

      expect(facade.calls).toContainEqual({
        method: 'setLayoutProperty',
        args: ['signal-heatmap', 'visibility', 'visible'],
      })
    })

    it('keeps the heatmap hidden when signals are globally hidden', async () => {
      const containerRef = makeContainerRef()
      await bootMap(
        facade, containerRef,
        defaultInput(containerRef, { showHeatmap: true, showSignals: false }),
      )

      expect(facade.calls).toContainEqual({
        method: 'setLayoutProperty',
        args: ['signal-heatmap', 'visibility', 'none'],
      })
    })
  })

  describe('breach pulse animation', () => {
    const breachedSite = {
      id: 'site-1',
      name: 'Site One',
      latitude: 10,
      longitude: 20,
      status: 'active' as const,
      geofence_radius_km: 12,
      area_of_operation_id: null,
      flagged_at: null,
      flag_reason: null,
      created_at: '2026-03-26T00:00:00Z',
      updated_at: '2026-03-26T00:00:00Z',
    }

    it('drives the breach ring pulse from requestAnimationFrame', async () => {
      const containerRef = makeContainerRef()
      const rafCallbacks = new Map<number, FrameRequestCallback>()
      let nextFrameId = 1
      const requestAnimationFrameSpy = vi
        .spyOn(window, 'requestAnimationFrame')
        .mockImplementation(callback => {
          const frameId = nextFrameId++
          rafCallbacks.set(frameId, callback)
          return frameId
        })
      const cancelAnimationFrameSpy = vi
        .spyOn(window, 'cancelAnimationFrame')
        .mockImplementation(frameId => {
          rafCallbacks.delete(frameId)
        })

      try {
        await bootMap(facade, containerRef, defaultInput(containerRef, {
          sites: [breachedSite],
          breachedSiteIds: new Set(['site-1']),
        }))

        expect(requestAnimationFrameSpy).toHaveBeenCalled()

        const firstFrame = rafCallbacks.get(1)
        expect(firstFrame).toBeDefined()

        await act(async () => {
          firstFrame?.(630)
        })

        expect(facade.calls).toContainEqual({
          method: 'setPaintProperty',
          args: ['geofence-breach-stroke', 'line-opacity', expect.any(Number)],
        })
        expect(cancelAnimationFrameSpy).not.toHaveBeenCalled()
      } finally {
        requestAnimationFrameSpy.mockRestore()
        cancelAnimationFrameSpy.mockRestore()
      }
    })

    it('cancels the frame loop and restores default opacity when breaches clear', async () => {
      const containerRef = makeContainerRef()
      const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 7)
      const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})

      try {
        const hook = await bootMap(facade, containerRef, defaultInput(containerRef, {
          sites: [breachedSite],
          breachedSiteIds: new Set(['site-1']),
        }))

        await act(async () => {
          hook.rerender(defaultInput(containerRef, {
            sites: [breachedSite],
            breachedSiteIds: new Set(),
          }))
        })

        expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(7)
        expect(facade.calls).toContainEqual({
          method: 'setPaintProperty',
          args: ['geofence-breach-stroke', 'line-opacity', 0.7],
        })
      } finally {
        requestAnimationFrameSpy.mockRestore()
        cancelAnimationFrameSpy.mockRestore()
      }
    })
  })
})
