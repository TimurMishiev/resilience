import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

// Playback rates: simulated minutes advanced per real second of playback
export const PLAYBACK_RATES = [1, 5, 15, 60] as const
export type PlaybackRate = (typeof PLAYBACK_RATES)[number]

/** Minutes jumped per step-forward / step-backward button press */
export const REPLAY_STEP_MINUTES = 5

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

      const advanceMs = playbackRate * TICK_MS * 60   // minutes × ms per tick × 60 s/min
      const nextMs    = new Date(current).getTime() + advanceMs
      const nowMs     = Date.now()

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
    const nowMs   = Date.now()
    const nextMs  = Math.min(
      new Date(current).getTime() + REPLAY_STEP_MINUTES * 60_000,
      nowMs - 1_000,
    )
    const next = new Date(nextMs).toISOString()
    asOfRef.current = next
    setAsOfState(next)
  }, [])

  const stepBackward = useCallback(() => {
    const current = asOfRef.current
    if (!current) return
    const prev = new Date(
      new Date(current).getTime() - REPLAY_STEP_MINUTES * 60_000,
    ).toISOString()
    asOfRef.current = prev
    setAsOfState(prev)
  }, [])

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
