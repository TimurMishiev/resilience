import type { ReactNode } from 'react'
import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReplayProvider, useReplay } from '../context/ReplayContext'
import { REPLAY_STEP_LOOKBACK_DAYS, REPLAY_STEP_MINUTES } from '../context/replayTransport'

function wrapper({ children }: { children: ReactNode }) {
  return <ReplayProvider>{children}</ReplayProvider>
}

describe('ReplayContext', () => {
  describe('initial state', () => {
    it('starts in live mode', () => {
      const { result } = renderHook(() => useReplay(), { wrapper })
      expect(result.current.asOf).toBeNull()
      expect(result.current.isReplaying).toBe(false)
      expect(result.current.isPlaying).toBe(false)
      expect(result.current.playbackRate).toBe(5)
    })
  })

  describe('setAsOf', () => {
    it('sets the timestamp and enters replay mode', () => {
      const { result } = renderHook(() => useReplay(), { wrapper })
      const ts = '2026-03-01T12:00:00.000Z'
      act(() => result.current.setAsOf(ts))
      expect(result.current.asOf).toBe(ts)
      expect(result.current.isReplaying).toBe(true)
    })

    it('pauses playback when called mid-play', () => {
      const { result } = renderHook(() => useReplay(), { wrapper })
      act(() => result.current.setAsOf('2026-03-01T12:00:00.000Z'))
      act(() => result.current.play())
      expect(result.current.isPlaying).toBe(true)
      act(() => result.current.setAsOf('2026-03-01T11:00:00.000Z'))
      expect(result.current.isPlaying).toBe(false)
    })

    it('clearing to null stops replay', () => {
      const { result } = renderHook(() => useReplay(), { wrapper })
      act(() => result.current.setAsOf('2026-03-01T12:00:00.000Z'))
      act(() => result.current.setAsOf(null))
      expect(result.current.asOf).toBeNull()
      expect(result.current.isReplaying).toBe(false)
      expect(result.current.isPlaying).toBe(false)
    })
  })

  describe('play / pause', () => {
    it('play() sets isPlaying to true', () => {
      const { result } = renderHook(() => useReplay(), { wrapper })
      act(() => result.current.setAsOf('2026-03-01T12:00:00.000Z'))
      act(() => result.current.play())
      expect(result.current.isPlaying).toBe(true)
    })

    it('play() does nothing when asOf is null (live mode)', () => {
      const { result } = renderHook(() => useReplay(), { wrapper })
      act(() => result.current.play())
      expect(result.current.isPlaying).toBe(false)
    })

    it('pause() sets isPlaying to false', () => {
      const { result } = renderHook(() => useReplay(), { wrapper })
      act(() => result.current.setAsOf('2026-03-01T12:00:00.000Z'))
      act(() => result.current.play())
      act(() => result.current.pause())
      expect(result.current.isPlaying).toBe(false)
    })
  })

  describe('stepForward / stepBackward', () => {
    const baseTs = '2026-03-01T12:00:00.000Z'

    it('stepForward() advances by REPLAY_STEP_MINUTES', () => {
      const { result } = renderHook(() => useReplay(), { wrapper })
      act(() => result.current.setAsOf(baseTs))
      act(() => result.current.stepForward())
      const expectedMs = new Date(baseTs).getTime() + REPLAY_STEP_MINUTES * 60_000
      expect(result.current.asOf).toBe(new Date(expectedMs).toISOString())
    })

    it('stepBackward() retreats by REPLAY_STEP_MINUTES', () => {
      const { result } = renderHook(() => useReplay(), { wrapper })
      act(() => result.current.setAsOf(baseTs))
      act(() => result.current.stepBackward())
      const expectedMs = new Date(baseTs).getTime() - REPLAY_STEP_MINUTES * 60_000
      expect(result.current.asOf).toBe(new Date(expectedMs).toISOString())
    })

    it('stepForward() is capped 1 second before now', () => {
      const farFutureTs = new Date(Date.now() + 10 * 60_000).toISOString()
      const { result } = renderHook(() => useReplay(), { wrapper })
      act(() => result.current.setAsOf(farFutureTs))
      act(() => result.current.stepForward())
      // Must be at most 1 s before Date.now()
      expect(new Date(result.current.asOf!).getTime()).toBeLessThan(Date.now())
    })

    it('stepForward() pauses playback', () => {
      const { result } = renderHook(() => useReplay(), { wrapper })
      act(() => result.current.setAsOf(baseTs))
      act(() => result.current.play())

      expect(result.current.isPlaying).toBe(true)

      act(() => result.current.stepForward())

      expect(result.current.isPlaying).toBe(false)
      expect(result.current.asOf).toBe(new Date(
        new Date(baseTs).getTime() + REPLAY_STEP_MINUTES * 60_000,
      ).toISOString())
    })

    it('stepBackward() pauses playback', () => {
      const { result } = renderHook(() => useReplay(), { wrapper })
      act(() => result.current.setAsOf(baseTs))
      act(() => result.current.play())

      expect(result.current.isPlaying).toBe(true)

      act(() => result.current.stepBackward())

      expect(result.current.isPlaying).toBe(false)
      expect(result.current.asOf).toBe(new Date(
        new Date(baseTs).getTime() - REPLAY_STEP_MINUTES * 60_000,
      ).toISOString())
    })

    it('stepBackward() does not go earlier than the configured lookback floor', () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-03-31T12:00:00.000Z'))

        const floorMs = Date.now() - REPLAY_STEP_LOOKBACK_DAYS * 86_400_000
        const startMs = floorMs + 2 * 60_000
        const { result } = renderHook(() => useReplay(), { wrapper })

        act(() => result.current.setAsOf(new Date(startMs).toISOString()))
        act(() => result.current.stepBackward())

        expect(result.current.asOf).toBe(new Date(floorMs).toISOString())
      } finally {
        vi.useRealTimers()
      }
    })

    it('stepForward/stepBackward are no-ops when not replaying', () => {
      const { result } = renderHook(() => useReplay(), { wrapper })
      act(() => result.current.stepForward())
      act(() => result.current.stepBackward())
      expect(result.current.asOf).toBeNull()
    })
  })

  describe('setPlaybackRate', () => {
    it('updates the playback rate', () => {
      const { result } = renderHook(() => useReplay(), { wrapper })
      act(() => result.current.setPlaybackRate(60))
      expect(result.current.playbackRate).toBe(60)
    })
  })

  describe('auto-advance timer', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('advances asOf on each tick when playing', async () => {
      // Pin "now" far enough ahead that ticks don't overshoot
      const baseMs   = Date.now() - 60 * 60_000   // 1 hour ago
      const baseTs   = new Date(baseMs).toISOString()

      const { result } = renderHook(() => useReplay(), { wrapper })
      act(() => result.current.setAsOf(baseTs))
      act(() => result.current.setPlaybackRate(1))
      act(() => result.current.play())

      // Advance real time by one tick (500 ms)
      await act(async () => { vi.advanceTimersByTime(500) })

      const afterMs = new Date(result.current.asOf!).getTime()
      // Should have advanced by 1 rate × 500 ms tick × 60 s/min = 30 000 ms
      expect(afterMs).toBeGreaterThan(baseMs)
      expect(afterMs).toBeLessThanOrEqual(baseMs + 35_000)  // 500 ms tolerance
    })

    it('returns to live and stops playback when catching up to now', async () => {
      // Set timestamp just behind now so the first tick overshoots
      const nearNowTs = new Date(Date.now() - 1_000).toISOString()

      const { result } = renderHook(() => useReplay(), { wrapper })
      act(() => result.current.setAsOf(nearNowTs))
      act(() => result.current.setPlaybackRate(60))   // large advance per tick
      act(() => result.current.play())

      await act(async () => { vi.advanceTimersByTime(500) })

      expect(result.current.asOf).toBeNull()
      expect(result.current.isReplaying).toBe(false)
      expect(result.current.isPlaying).toBe(false)
    })

    it('uses the latest playback rate after it changes mid-play', async () => {
      const baseMs = Date.now() - 60 * 60_000
      const baseTs = new Date(baseMs).toISOString()

      const { result } = renderHook(() => useReplay(), { wrapper })
      act(() => result.current.setAsOf(baseTs))
      act(() => result.current.setPlaybackRate(1))
      act(() => result.current.play())

      await act(async () => { vi.advanceTimersByTime(500) })
      const afterFirstTickMs = new Date(result.current.asOf!).getTime()
      expect(afterFirstTickMs - baseMs).toBe(30_000)

      act(() => result.current.setPlaybackRate(60))
      await act(async () => { vi.advanceTimersByTime(500) })

      const afterSecondTickMs = new Date(result.current.asOf!).getTime()
      expect(afterSecondTickMs - afterFirstTickMs).toBe(1_800_000)
    })
  })
})
