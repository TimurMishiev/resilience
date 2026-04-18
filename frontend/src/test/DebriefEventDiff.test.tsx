import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DebriefEventDiff from '../components/DebriefEventDiff'
import type { AuditEvent } from '../api/types'

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'e-diff',
    schema_version: 1,
    actor: 'cmdr@example.com',
    entity_type: 'Task',
    entity_id: 't1',
    event_type: 'task.transitioned',
    action: 'resolved',
    before_snapshot: { workflow_status: 'new', priority: 'normal' },
    after_snapshot: { workflow_status: 'resolved', priority: 'normal', resolved_at: '2026-04-18T10:00:00Z' },
    metadata: null,
    correlation_id: 'c1',
    occurred_at: '2026-04-18T10:00:00Z',
    ...overrides,
  }
}

describe('DebriefEventDiff', () => {
  it('renders nothing when event is null (drawer closed)', () => {
    const { container } = render(<DebriefEventDiff event={null} onClose={vi.fn()} />)
    expect(container.querySelector('.debrief-diff')).not.toBeInTheDocument()
  })

  it('renders changed, added, and removed sections with field values', () => {
    render(<DebriefEventDiff event={makeEvent()} onClose={vi.fn()} />)

    // header
    expect(screen.getByText('Task changes')).toBeInTheDocument()

    // changed field — workflow_status: new → resolved
    expect(screen.getByText('Changed')).toBeInTheDocument()
    expect(screen.getByText('workflow status')).toBeInTheDocument()
    // Scope before/after queries via testids (the "resolved" string also appears in the
    // header action tag, so `getByText('resolved')` would be ambiguous across contexts).
    const beforeCells = screen.getAllByTestId('diff-before')
    const afterCells = screen.getAllByTestId('diff-after')
    expect(beforeCells.some((el) => el.textContent === 'new')).toBe(true)
    expect(afterCells.some((el) => el.textContent === 'resolved')).toBe(true)

    // added field — resolved_at
    expect(screen.getByText('Added')).toBeInTheDocument()
    expect(screen.getByText('resolved at')).toBeInTheDocument()
    expect(screen.getByText('2026-04-18T10:00:00Z')).toBeInTheDocument()
  })

  it('shows the empty-diff NonIdealState when before and after are identical', () => {
    const event = makeEvent({
      before_snapshot: { status: 'active' },
      after_snapshot: { status: 'active' },
    })
    render(<DebriefEventDiff event={event} onClose={vi.fn()} />)

    expect(screen.getByText(/No field changes/i)).toBeInTheDocument()
  })

  it('treats a null before_snapshot as a creation — all fields are added', () => {
    const event = makeEvent({
      before_snapshot: null,
      after_snapshot: { id: 'i1', status: 'open' },
    })
    render(<DebriefEventDiff event={event} onClose={vi.fn()} />)

    expect(screen.getByText('Added')).toBeInTheDocument()
    expect(screen.getByText('id')).toBeInTheDocument()
    expect(screen.getByText('i1')).toBeInTheDocument()
    expect(screen.getByText('status')).toBeInTheDocument()
    expect(screen.getByText('open')).toBeInTheDocument()
    expect(screen.queryByText('Changed')).not.toBeInTheDocument()
    expect(screen.queryByText('Removed')).not.toBeInTheDocument()
  })
})
