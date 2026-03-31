import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  REPLAY_STEP_LOOKBACK_DAYS,
  REPLAY_STEP_MINUTES,
  type PlaybackRate,
} from './replayTransport'

const TICK_MS = 500

interface ReplayContextValue {
  asOf: string | null
  setAsOf: (value: string | null) => void
  isReplaying: boolean
  isPlaying: boolean
  playbackRate: PlaybackRate
  play: () => void
  pause: () => void
  setPlaybackRate: (rate: PlaybackRate) => void
  stepForward: () => void
  stepBackward: () => void
}

const ReplayContext = createContext<ReplayContextValue | null>(null)

export function ReplayProvider({ children }: { children: ReactNode }) {
  const [asOf, setAsOfState] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackRate, setPlaybackRateState] = useState<PlaybackRate>(5)

  // Ref mirrors asOf so the auto-advance interval always reads the latest
  // position without closing over a stale value.
  const asOfRef = useRef<string | null>(null)

  // -------------------------------------------------------------------
  // Public setAsOf — always pauses; clears state when called with null.
  // Used by the datetime picker and the "Return to live" button.
  // -------------------------------------------------------------------
  const setAsOf = useCallback((value: string | null) => {
    setIsPlaying(false)
    asOfRef.current = value
    setAsOfState(value)
  }, [])

  // -------------------------------------------------------------------
  // Auto-advance timer — ticks every TICK_MS ms when playing.
  // Advances asOf by (playbackRate * TICK_MS / 1000) minutes per tick.
  // Stops and returns to live when the simulated time reaches now.
  // -------------------------------------------------------------------
  useEffect(() => {
    if (!isPlaying) return

    const id = setInterval(() => {
      const current = asOfRef.current
      if (!current) {
        setIsPlaying(false)
        return
      }

      // playbackRate is simulated minutes per real second:
      // (min / real sec) × TICK_MS (ms real) × 60 = simulated ms per tick.
      const advanceMs = playbackRate * TICK_MS * 60
      const nextMs = new Date(current).getTime() + advanceMs
      const nowMs = Date.now()

      if (nextMs >= nowMs) {
        // Reached live — stop playback and clear the frozen timestamp
        asOfRef.current = null
        setAsOfState(null)
        setIsPlaying(false)
      } else {
        const next = new Date(nextMs).toISOString()
        asOfRef.current = next
        setAsOfState(next)
      }
    }, TICK_MS)

    return () => clearInterval(id)
  }, [isPlaying, playbackRate])

  // -------------------------------------------------------------------
  // Transport controls
  // -------------------------------------------------------------------
  const play = useCallback(() => {
    if (!asOfRef.current) return   // no position to play from
    setIsPlaying(true)
  }, [])

  const pause = useCallback(() => setIsPlaying(false), [])

  const setPlaybackRate = useCallback((rate: PlaybackRate) => {
    setPlaybackRateState(rate)
  }, [])

  const stepForward = useCallback(() => {
    const current = asOfRef.current
    if (!current) return
    const nowMs = Date.now()
    const nextMs = Math.min(
      new Date(current).getTime() + REPLAY_STEP_MINUTES * 60_000,
      nowMs - 1_000,
    )
    setAsOf(new Date(nextMs).toISOString())
  }, [setAsOf])

  const stepBackward = useCallback(() => {
    const current = asOfRef.current
    if (!current) return
    const currentMs = new Date(current).getTime()
    const floorMs = Date.now() - REPLAY_STEP_LOOKBACK_DAYS * 86_400_000
    if (currentMs <= floorMs) return
    const prevMs = Math.max(currentMs - REPLAY_STEP_MINUTES * 60_000, floorMs)
    setAsOf(new Date(prevMs).toISOString())
  }, [setAsOf])

  return (
    <ReplayContext.Provider value={{
      asOf,
      setAsOf,
      isReplaying: asOf !== null,
      isPlaying,
      playbackRate,
      play,
      pause,
      setPlaybackRate,
      stepForward,
      stepBackward,
    }}>
      {children}
    </ReplayContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useReplay(): ReplayContextValue {
  const ctx = useContext(ReplayContext)
  if (!ctx) throw new Error('useReplay must be used inside ReplayProvider')
  return ctx
}
