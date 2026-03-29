import { useRef } from 'react'
import { Button, Tag } from '@blueprintjs/core'
import { useReplay, PLAYBACK_RATES } from '../context/ReplayContext'
import type { PlaybackRate } from '../context/ReplayContext'

export default function ReplaySelector() {
  const {
    asOf, setAsOf, isReplaying, isPlaying, playbackRate,
    play, pause, setPlaybackRate, stepForward, stepBackward,
  } = useReplay()
  const inputRef = useRef<HTMLInputElement>(null)

  function commit(val: string) {
    if (!val) {
      setAsOf(null)
      return
    }
    // datetime-local gives "YYYY-MM-DDTHH:mm" — convert to full ISO
    const parsed = new Date(val)
    if (!isNaN(parsed.getTime())) {
      setAsOf(parsed.toISOString())
    }
  }

  function handleClear() {
    setAsOf(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  // Convert ISO string back to datetime-local format for the input
  const inputValue = asOf
    ? new Date(asOf).toISOString().slice(0, 16)
    : ''

  return (
    <div className="replay-selector">
      <Tag
        minimal
        intent={isReplaying ? 'warning' : 'success'}
        className="replay-status-tag"
      >
        {isReplaying ? 'REPLAY' : 'LIVE'}
      </Tag>

      <input
        ref={inputRef}
        type="datetime-local"
        className="replay-input"
        defaultValue={inputValue}
        key={inputValue}          /* re-mount when cleared so the value resets */
        max={new Date().toISOString().slice(0, 16)}
        onChange={(e) => commit(e.currentTarget.value)}
        onBlur={(e) => commit(e.currentTarget.value)}
        title="Set replay timestamp — leave empty for live data"
      />

      {isReplaying && (
        <>
          <Button
            minimal small icon="step-backward"
            onClick={stepBackward}
            title="Step back 5 minutes"
          />
          <Button
            minimal small
            icon={isPlaying ? 'pause' : 'play'}
            onClick={isPlaying ? pause : play}
            title={isPlaying ? 'Pause playback' : 'Start playback'}
            intent={isPlaying ? 'warning' : 'none'}
          />
          <Button
            minimal small icon="step-forward"
            onClick={stepForward}
            title="Step forward 5 minutes"
          />
          <div className="replay-rate-selector" role="group" aria-label="Playback speed">
            {PLAYBACK_RATES.map((rate: PlaybackRate) => (
              <button
                key={rate}
                className={`replay-rate-btn${playbackRate === rate ? ' replay-rate-btn--active' : ''}`}
                onClick={() => setPlaybackRate(rate)}
                title={`${rate} min / sec`}
                aria-pressed={playbackRate === rate}
              >
                {rate}×
              </button>
            ))}
          </div>
          <Button
            minimal small icon="cross"
            title="Return to live"
            onClick={handleClear}
          />
        </>
      )}
    </div>
  )
}
