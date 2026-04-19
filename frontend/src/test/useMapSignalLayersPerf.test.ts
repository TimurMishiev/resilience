import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/mapEngineSignalLayers', () => ({
  ensureSignalLayers: vi.fn(() => () => {}),
  updateSignalSources: vi.fn(),
}))
vi.mock('../lib/mapSignalRendering', () => ({
  buildMapSignalFeatureCollection: vi.fn(() => ({ type: 'FeatureCollection', features: [] })),
  buildMapSignalRenderCollections: vi.fn(() => ({
    clusterable: { type: 'FeatureCollection', features: [] },
    selected:    { type: 'FeatureCollection', features: [] },
  })),
}))

const recordPerfEvent = vi.fn()
vi.mock('../lib/perfInstrumentation', () => ({
  isPerfEnabled: () => window.localStorage.getItem('resilience.perf') === '1',
  nowMs: () => 1000,
  recordPerfEvent: (...args: unknown[]) => recordPerfEvent(...args),
}))

import { useMapSignalLayers, type MapSignalLayersInput } from '../hooks/map/useMapSignalLayers'
import type { Signal } from '../api/types'

function buildSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'sig-1',
    signal_type: 'vessel_position',
    source: 'ais',
    lat: 1, lng: 2,
    occurred_at: '2026-04-19T00:00:00Z',
    external_id: null,
    raw_payload: {},
    ...overrides,
  } as Signal
}

function buildInput(overrides: Partial<MapSignalLayersInput> = {}): MapSignalLayersInput {
  const fakeMap = { getLayer: () => null, addLayer: vi.fn(), setFilter: vi.fn(), setLayoutProperty: vi.fn() } as unknown as MapSignalLayersInput['mapRef']['current']
  return {
    mapRef:            { current: fakeMap },
    maplibreRef:       { current: null },
    mapLoaded:         true,
    signals:           [],
    selectedSignalId:  null,
    referenceTimeMs:   Date.parse('2026-04-19T00:00:01Z'),
    showSignals:       true,
    showHeatmap:       false,
    onSignalClickRef:  { current: vi.fn() },
    evidenceSignalIds: [],
    ...overrides,
  }
}

describe('useMapSignalLayers — perf instrumentation', () => {
  beforeEach(() => {
    recordPerfEvent.mockReset()
    window.localStorage.clear()
    // Synchronous double-rAF so paint-completion recording is deterministic.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(((cb: FrameRequestCallback) => {
      cb(0); return 1
    }) as typeof window.requestAnimationFrame)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((() => {}) as typeof window.cancelAnimationFrame)
  })

  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('records nothing when perf is disabled', () => {
    renderHook(() => useMapSignalLayers(buildInput({ signals: [buildSignal()] })))
    expect(recordPerfEvent).not.toHaveBeenCalled()
  })

  it('records a map.signal_reconcile event when perf is enabled', () => {
    window.localStorage.setItem('resilience.perf', '1')
    renderHook(() => useMapSignalLayers(buildInput({ signals: [buildSignal(), buildSignal({ id: 'sig-2' })] })))
    expect(recordPerfEvent).toHaveBeenCalledTimes(1)
    const [name, details, durationMs] = recordPerfEvent.mock.calls[0]
    expect(name).toBe('map.signal_reconcile')
    expect(details).toMatchObject({
      signalCount: 2,
      signalCountDelta: 2,
      selectedSignalId: null,
      selectionChanged: false,
      trigger: 'signals_changed',
      jsMs: 0,
    })
    expect(durationMs).toBe(0)
  })

  it('records jsMs separately from durationMs (paint-completion total)', () => {
    window.localStorage.setItem('resilience.perf', '1')
    renderHook(() => useMapSignalLayers(buildInput({ signals: [buildSignal()] })))
    const [, details, durationMs] = recordPerfEvent.mock.calls[0]
    // Under the mocked nowMs both are zero; the contract being asserted is
    // that jsMs is present in details and durationMs is reported separately.
    expect(details).toMatchObject({ jsMs: 0 })
    expect(durationMs).toBe(0)
  })


  it('reports selection_set on first selection and selection_cleared on clear', () => {
    window.localStorage.setItem('resilience.perf', '1')
    const initial = buildInput({ signals: [buildSignal()] })
    const { rerender } = renderHook(
      (props: MapSignalLayersInput) => useMapSignalLayers(props),
      { initialProps: initial },
    )
    rerender(buildInput({ signals: [buildSignal()], selectedSignalId: 'sig-1' }))
    rerender(buildInput({ signals: [buildSignal()], selectedSignalId: null }))

    const triggers = recordPerfEvent.mock.calls.map(call => (call[1] as { trigger: string }).trigger)
    expect(triggers).toEqual(['signals_changed', 'selection_set', 'selection_cleared'])
  })

  it('reports reference_time_changed when only referenceTimeMs changes', () => {
    window.localStorage.setItem('resilience.perf', '1')
    const signals = [buildSignal()]
    const baseTime = Date.parse('2026-04-19T00:00:01Z')
    const { rerender } = renderHook(
      (props: MapSignalLayersInput) => useMapSignalLayers(props),
      { initialProps: buildInput({ signals, referenceTimeMs: baseTime }) },
    )
    rerender(buildInput({ signals, referenceTimeMs: baseTime + 60_000 }))
    const triggers = recordPerfEvent.mock.calls.map(call => (call[1] as { trigger: string }).trigger)
    expect(triggers).toEqual(['signals_changed', 'reference_time_changed'])
  })

  // Regression guard for the rAF-preemption bug found while landing 6-1C:
  // previousSignalCountRef / previousSelectedSignalIdRef must commit INSIDE
  // the inner rAF callback, not synchronously alongside the trigger compute.
  // If refs commit synchronously, a cancelled rAF (effect torn down before
  // paint) still mutates previous-state, and the next effect mis-classifies a
  // surviving selection change as `reference_time_changed`, silently dropping
  // it from the benchmark sample (which filters on `selection_set`).
  it('preserves selection_set across rAF preemption (refs commit inside rAF)', () => {
    window.localStorage.setItem('resilience.perf', '1')

    const queue = new Map<number, FrameRequestCallback>()
    let nextId = 1
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(((cb: FrameRequestCallback) => {
      const id = nextId++
      queue.set(id, cb)
      return id
    }) as typeof window.requestAnimationFrame)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(((id: number) => {
      queue.delete(id)
    }) as typeof window.cancelAnimationFrame)

    const flushQueue = () => {
      while (queue.size > 0) {
        const [id, cb] = queue.entries().next().value as [number, FrameRequestCallback]
        queue.delete(id)
        cb(0)
      }
    }

    const signals = [buildSignal()]
    const baseTime = Date.parse('2026-04-19T00:00:01Z')
    const { rerender } = renderHook(
      (props: MapSignalLayersInput) => useMapSignalLayers(props),
      { initialProps: buildInput({ signals, referenceTimeMs: baseTime }) },
    )

    // Selection rerender — schedules outer rAF for selection_set; do NOT flush.
    rerender(buildInput({ signals, selectedSignalId: 'sig-1', referenceTimeMs: baseTime }))

    // Preempting rerender — React runs the prior effect's cleanup first
    // (cancelling its queued rAF), then the new effect runs and queues its own
    // rAF.  Because refs are committed inside the rAF, the cancelled effect
    // never advanced previousSelectedSignalIdRef past `null`, so the surviving
    // effect still sees the selection change.
    rerender(buildInput({ signals, selectedSignalId: 'sig-1', referenceTimeMs: baseTime + 60_000 }))

    flushQueue()

    const triggers = recordPerfEvent.mock.calls.map(call => (call[1] as { trigger: string }).trigger)
    expect(triggers).toEqual(['selection_set'])
  })
})
