/**
 * IncidentNotesPanel
 *
 * Append-only operator notes log for an incident.
 * Notes are immutable once submitted — the log is the record.
 */
import { useState, useRef, useEffect } from 'react'
import { Button, Callout, NonIdealState, Spinner, TextArea } from '@blueprintjs/core'
import { useIncidentNotes, useAddIncidentNote } from '../hooks/useIncidents'

interface Props {
  incidentId: string
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function IncidentNotesPanel({ incidentId }: Props) {
  const [body, setBody]     = useState('')
  const bottomRef           = useRef<HTMLDivElement>(null)
  const { data: notes = [], isPending, error } = useIncidentNotes(incidentId)
  const addNote             = useAddIncidentNote()

  // Scroll to bottom when new notes arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [notes.length])

  function handleSubmit() {
    const trimmed = body.trim()
    if (!trimmed) return
    addNote.mutate(
      { id: incidentId, body: trimmed },
      { onSuccess: () => setBody('') }
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── note log ── */}
      <div style={{
        maxHeight: 360,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        paddingRight: 4,
      }}>
        {isPending && <Spinner size={20} />}
        {error   && <Callout intent="danger" compact>{error.message}</Callout>}
        {!isPending && notes.length === 0 && (
          <NonIdealState
            icon="annotation"
            title="No notes yet"
            description="Add the first operational note below."
            className="tab-empty-state"
          />
        )}
        {notes.map(note => (
          <div
            key={note.id}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border:     '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              padding:    '10px 14px',
            }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              marginBottom: 6,
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.8 }}>
                {note.author.email}
              </span>
              <span style={{ fontSize: 11, opacity: 0.5 }}>
                {fmt(note.created_at)}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {note.body}
            </p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── add note form ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <TextArea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Add an operational note… (Ctrl+Enter to submit)"
          rows={3}
          style={{ resize: 'vertical', fontSize: 13 }}
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              handleSubmit()
            }
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            intent="primary"
            small
            loading={addNote.isPending}
            disabled={!body.trim()}
            onClick={handleSubmit}
          >
            Add Note
          </Button>
        </div>
      </div>
    </div>
  )
}
