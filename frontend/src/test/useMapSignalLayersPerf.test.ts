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
  })

  afterEach(() => {
    window.localStorage.clear()
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
    })
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
})
