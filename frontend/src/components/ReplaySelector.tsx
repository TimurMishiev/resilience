import { useRef } from 'react'
import { Button, Tag } from '@blueprintjs/core'
import { useReplay } from '../context/ReplayContext'

export default function ReplaySelector() {
  const { asOf, setAsOf, isReplaying } = useReplay()
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
        <Button
          minimal
          small
          icon="cross"
          title="Return to live"
          onClick={handleClear}
        />
      )}
    </div>
  )
}
