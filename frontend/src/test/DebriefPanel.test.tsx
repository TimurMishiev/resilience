import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/audit_events', () => ({
  getAuditEvents: vi.fn().mockResolvedValue([
    {
      id: 'e1',
      schema_version: 1,
      actor: 'cmdr@example.com',
      entity_type: 'Incident',
      entity_id: 'i1',
      event_type: 'incident.opened',
      action: null,
      before_snapshot: null,
      after_snapshot: {},
      metadata: null,
      correlation_id: 'c1',
      occurred_at: '2026-04-17T12:00:00Z',
    },
    {
      id: 'e2',
      schema_version: 1,
      actor: 'op@example.com',
      entity_type: 'Task',
      entity_id: 't1',
      event_type: 'task.transitioned',
      action: 'resolved',
      before_snapshot: null,
      after_snapshot: {},
      metadata: null,
      correlation_id: 'c2',
      occurred_at: '2026-04-17T11:30:00Z',
    },
  ]),
}))

import DebriefPanel from '../components/DebriefPanel'

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(<DebriefPanel />, { wrapper })
}

describe('DebriefPanel', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders fetched events with entity type and event label', async () => {
    renderPanel()

    expect(await screen.findByText('Incident')).toBeInTheDocument()
    expect(screen.getByText('Task')).toBeInTheDocument()
    expect(screen.getByText('incident.opened')).toBeInTheDocument()
    expect(screen.getByText('resolved')).toBeInTheDocument()
  })

  it('refetches with a narrower window when the range changes', async () => {
    const user = userEvent.setup()
    const { getAuditEvents } = await import('../api/audit_events')
    renderPanel()

    // initial fetch is 24h default
    await screen.findByText('Incident')
    const firstCall = (getAuditEvents as ReturnType<typeof vi.fn>).mock.calls[0][0]

    await user.selectOptions(screen.getByLabelText(/Time range/i), '1h')

    await waitFor(() => {
      expect((getAuditEvents as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1)
    })
    const secondCall = (getAuditEvents as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]
    expect(secondCall.from).not.toEqual(firstCall.from)
    expect(new Date(secondCall.from).getTime()).toBeGreaterThan(new Date(firstCall.from).getTime())
  })

  it('renders the empty state when no events are returned', async () => {
    const { getAuditEvents } = await import('../api/audit_events')
    ;(getAuditEvents as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])

    renderPanel()

    expect(await screen.findByText(/No meaningful activity/i)).toBeInTheDocument()
    expect(
      screen.getByText(/No operationally significant events occurred in this range/i),
    ).toBeInTheDocument()
  })

  it('renders the error callout when the query fails', async () => {
    const { getAuditEvents } = await import('../api/audit_events')
    ;(getAuditEvents as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'))

    renderPanel()

    expect(await screen.findByText('boom')).toBeInTheDocument()
  })
})
