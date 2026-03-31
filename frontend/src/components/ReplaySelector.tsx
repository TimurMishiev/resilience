import { useRef, useState } from 'react'
import { Button, Tag } from '@blueprintjs/core'
import { useReplay } from '../context/ReplayContext'
import { PLAYBACK_RATES, type PlaybackRate } from '../context/replayTransport'

function formatInputValue(asOf: string | null): string {
  return asOf ? new Date(asOf).toISOString().slice(0, 16) : ''
}

export default function ReplaySelector() {
  const {
    asOf, setAsOf, isReplaying, isPlaying, playbackRate,
    play, pause, setPlaybackRate, stepForward, stepBackward,
  } = useReplay()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [draftValue, setDraftValue] = useState('')
  const inputValue = isEditing ? draftValue : formatInputValue(asOf)

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
    setIsEditing(false)
    setAsOf(null)
    setDraftValue('')
  }

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
        value={inputValue}
        max={new Date().toISOString().slice(0, 16)}
        onChange={(e) => setDraftValue(e.currentTarget.value)}
        onFocus={(e) => {
          setDraftValue(e.currentTarget.value)
          setIsEditing(true)
        }}
        onBlur={(e) => {
          setIsEditing(false)
          commit(e.currentTarget.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            inputRef.current?.blur()
          }
        }}
        title="Set replay timestamp — leave empty for live data"
      />

      {isReplaying && (
        <>
          <Button
            minimal small icon="step-backward"
            onClick={stepBackward}
            title="Step back 5 minutes and pause"
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
            title="Step forward 5 minutes and pause"
          />
          <div className="replay-rate-selector" role="group" aria-label="Playback speed">
            {PLAYBACK_RATES.map((rate: PlaybackRate) => (
              <Button
                key={rate}
                minimal
                small
                className={`replay-rate-btn${playbackRate === rate ? ' replay-rate-btn--active' : ''}`}
                onClick={() => setPlaybackRate(rate)}
                title={`${rate} min / sec`}
                aria-pressed={playbackRate === rate}
              >
                {rate}×
              </Button>
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
