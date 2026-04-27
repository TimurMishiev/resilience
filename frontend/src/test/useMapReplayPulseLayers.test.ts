import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/mapEngineReplayPulseLayers', () => ({
  ensureReplayPulseLayers: vi.fn(),
  updateReplayPulseSources: vi.fn(),
  applyReplayPulseBreath: vi.fn(),
  removeReplayPulseLayers: vi.fn(),
}))

import {
  ensureReplayPulseLayers,
  updateReplayPulseSources,
  applyReplayPulseBreath,
  removeReplayPulseLayers,
} from '../lib/mapEngineReplayPulseLayers'
import { useMapReplayPulseLayers, type MapReplayPulseLayersInput } from '../hooks/map/useMapReplayPulseLayers'
import type { Pulse } from '../lib/replayEventPulses'

function pulse(id: string): Pulse {
  return {
    id,
    lat: 10,
    lng: 20,
    eventType: 'site_flagged',
    occurredAt: '2026-04-26T12:00:00.000Z',
    intensity: 0.8,
  }
}

function buildInput(overrides: Partial<MapReplayPulseLayersInput> = {}): MapReplayPulseLayersInput {
  return {
    mapRef: { current: {} as MapReplayPulseLayersInput['mapRef']['current'] },
    mapLoaded: true,
    pulses: [],
    showReplayPulses: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(ensureReplayPulseLayers).mockReset()
  vi.mocked(updateReplayPulseSources).mockReset()
  vi.mocked(applyReplayPulseBreath).mockReset()
  vi.mocked(removeReplayPulseLayers).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useMapReplayPulseLayers', () => {
  it('does nothing when the map is not loaded', () => {
    renderHook(() =>
      useMapReplayPulseLayers(buildInput({ mapLoaded: false, showReplayPulses: true, pulses: [pulse('a')] })),
    )
    expect(ensureReplayPulseLayers).not.toHaveBeenCalled()
    expect(removeReplayPulseLayers).not.toHaveBeenCalled()
  })

  it('removes layers when showReplayPulses is false', () => {
    renderHook(() =>
      useMapReplayPulseLayers(buildInput({ showReplayPulses: false, pulses: [pulse('a')] })),
    )
    expect(removeReplayPulseLayers).toHaveBeenCalledTimes(1)
    expect(ensureReplayPulseLayers).not.toHaveBeenCalled()
  })

  it('mounts source/layers and applies pulses when showReplayPulses is true', () => {
    renderHook(() =>
      useMapReplayPulseLayers(buildInput({ showReplayPulses: true, pulses: [pulse('a')] })),
    )
    expect(ensureReplayPulseLayers).toHaveBeenCalledTimes(1)
    expect(updateReplayPulseSources).toHaveBeenCalledTimes(1)
    expect(removeReplayPulseLayers).not.toHaveBeenCalled()
  })

  it('does not start the breath loop when there are zero pulses', () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    renderHook(() =>
      useMapReplayPulseLayers(buildInput({ showReplayPulses: true, pulses: [] })),
    )
    expect(rafSpy).not.toHaveBeenCalled()
  })

  it('starts a rAF loop and applies breath while mounted with pulses', () => {
    // Synchronous rAF stub: fires once then no more, so the recursive
    // tick body runs exactly once and we can observe the breath call.
    let calls = 0
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(((cb: FrameRequestCallback) => {
      calls += 1
      if (calls === 1) cb(0)
      return calls
    }) as typeof window.requestAnimationFrame)
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((() => {}) as typeof window.cancelAnimationFrame)

    const { unmount } = renderHook(() =>
      useMapReplayPulseLayers(buildInput({ showReplayPulses: true, pulses: [pulse('a'), pulse('b')] })),
    )

    expect(applyReplayPulseBreath).toHaveBeenCalledTimes(1)
    expect(rafSpy).toHaveBeenCalled()

    unmount()
    expect(cafSpy).toHaveBeenCalled()
  })
})
