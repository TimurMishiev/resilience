import { Button, Tag } from '@blueprintjs/core'
import { useReplay } from '../context/ReplayContext'

export default function ReplaySelector() {
  const { asOf, setAsOf, isReplaying } = useReplay()

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.currentTarget.value
    if (!val) {
      setAsOf(null)
      return
    }
    // datetime-local gives "YYYY-MM-DDTHH:mm" — convert to full ISO with seconds
    setAsOf(new Date(val).toISOString())
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
        type="datetime-local"
        className="replay-input"
        value={inputValue}
        max={new Date().toISOString().slice(0, 16)}
        onChange={handleChange}
        title="Set replay timestamp — leave empty for live data"
      />

      {isReplaying && (
        <Button
          minimal
          small
          icon="cross"
          title="Return to live"
          onClick={() => setAsOf(null)}
        />
      )}
    </div>
  )
}
