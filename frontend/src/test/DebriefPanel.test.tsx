import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/audit_events', () => ({
  getAuditEventsPage: vi.fn().mockResolvedValue({
    data: [
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
    ],
    meta: {
      limit: 200,
      has_more: false,
      next_cursor: null,
    },
  }),
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
  beforeEach(async () => {
    vi.clearAllMocks()
    const { getAuditEventsPage } = await import('../api/audit_events')
    ;(getAuditEventsPage as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
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
      ],
      meta: {
        limit: 200,
        has_more: false,
        next_cursor: null,
      },
    })
  })

  it('renders fetched events with entity type and event label', async () => {
    renderPanel()

    expect(await screen.findByText('Incident')).toBeInTheDocument()
    expect(screen.getByText('Task')).toBeInTheDocument()
    expect(screen.getByText('incident.opened')).toBeInTheDocument()
    expect(screen.getByText('resolved')).toBeInTheDocument()
  })

  it('refetches with a narrower window when the range changes', async () => {
    const user = userEvent.setup()
    const { getAuditEventsPage } = await import('../api/audit_events')
    renderPanel()

    // initial fetch is 24h default
    await screen.findByText('Incident')
    const firstCall = (getAuditEventsPage as ReturnType<typeof vi.fn>).mock.calls[0][0]

    await user.selectOptions(screen.getByLabelText(/Time range/i), '1h')

    await waitFor(() => {
      expect((getAuditEventsPage as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1)
    })
    const secondCall = (getAuditEventsPage as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]
    expect(secondCall.from).not.toEqual(firstCall.from)
    expect(new Date(secondCall.from).getTime()).toBeGreaterThan(new Date(firstCall.from).getTime())
  })

  it('renders the empty state when no events are returned', async () => {
    const { getAuditEventsPage } = await import('../api/audit_events')
    ;(getAuditEventsPage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: [],
      meta: { limit: 200, has_more: false, next_cursor: null },
    })

    renderPanel()

    expect(await screen.findByText(/No meaningful activity/i)).toBeInTheDocument()
    expect(
      screen.getByText(/No operationally significant events occurred in this range/i),
    ).toBeInTheDocument()
  })

  it('renders the error callout when the query fails', async () => {
    const { getAuditEventsPage } = await import('../api/audit_events')
    ;(getAuditEventsPage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'))

    renderPanel()

    expect(await screen.findByText('boom')).toBeInTheDocument()
  })

  it('loads older events when the backend exposes a next cursor', async () => {
    const user = userEvent.setup()
    const { getAuditEventsPage } = await import('../api/audit_events')
    ;(getAuditEventsPage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        data: [
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
        ],
        meta: {
          limit: 200,
          has_more: true,
          next_cursor: {
            before_occurred_at: '2026-04-17T12:00:00.000000Z',
            before_id: 'e1',
          },
        },
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'e0',
            schema_version: 1,
            actor: 'cmdr@example.com',
            entity_type: 'Site',
            entity_id: 's1',
            event_type: 'site_status_changed',
            action: 'deactivate',
            before_snapshot: null,
            after_snapshot: {},
            metadata: null,
            correlation_id: 'c0',
            occurred_at: '2026-04-17T11:00:00Z',
          },
        ],
        meta: {
          limit: 200,
          has_more: false,
          next_cursor: null,
        },
      })

    renderPanel()

    expect(await screen.findByRole('button', { name: /Load older events/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Load older events/i }))

    expect(await screen.findByText('Site')).toBeInTheDocument()
    expect(screen.getByText('deactivate')).toBeInTheDocument()
  })
})
