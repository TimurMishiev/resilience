import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const replayState = vi.hoisted(() => ({
  setAsOf: vi.fn(),
}))

const mockToasterShow = vi.hoisted(() => vi.fn())

vi.mock('../lib/toaster', () => ({
  AppToaster: Promise.resolve({ show: mockToasterShow }),
}))

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

vi.mock('../api/tasks', () => ({
  getTask: vi.fn().mockResolvedValue({
    id: 't1',
    site_id: 'site-task',
    asset_id: null,
    title: 'Resolve outage',
    description: null,
    priority: 'high',
    workflow_status: 'new',
    blocked_reason: null,
    resolved_at: null,
    created_at: '2026-04-17T11:30:00Z',
    updated_at: '2026-04-17T11:30:00Z',
    site_name: 'Task Site',
    ao_id: 'ao-1',
    ao_posture: 'defensive',
  }),
}))

vi.mock('../api/assets', () => ({
  getAsset: vi.fn().mockResolvedValue({
    id: 'a1',
    name: 'Sentinel Drone',
    asset_type: 'uav',
    status: 'available',
    home_site_id: 'site-asset',
    last_reported_at: '2026-04-17T10:45:00Z',
    created_at: '2026-04-17T10:00:00Z',
    updated_at: '2026-04-17T10:45:00Z',
  }),
}))

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => replayState,
}))

import DebriefPanel from '../components/DebriefPanel'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function renderPanel(props: Parameters<typeof DebriefPanel>[0] = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={['/debrief']}>
      <QueryClientProvider client={queryClient}>
        <LocationProbe />
        {children}
      </QueryClientProvider>
    </MemoryRouter>
  )
  return render(<DebriefPanel {...props} />, { wrapper })
}

describe('DebriefPanel', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    replayState.setAsOf.mockReset()
    mockToasterShow.mockReset()
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

  it('enters replay and navigates directly for incident events', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: /Enter replay from Incident event/i }))

    expect(replayState.setAsOf).toHaveBeenCalledWith('2026-04-17T12:00:00Z')
    expect(screen.getByTestId('location')).toHaveTextContent('/incidents/i1')
  })

  it('resolves a task event into the site-scoped deep link at the replay timestamp', async () => {
    const user = userEvent.setup()
    const { getAuditEventsPage } = await import('../api/audit_events')
    const { getTask } = await import('../api/tasks')
    ;(getAuditEventsPage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: [
        {
          id: 'e-task',
          schema_version: 1,
          actor: 'op@example.com',
          entity_type: 'Task',
          entity_id: 't1',
          event_type: 'task.transitioned',
          action: 'resolved',
          before_snapshot: null,
          after_snapshot: {},
          metadata: null,
          correlation_id: 'ct',
          occurred_at: '2026-04-17T11:30:00Z',
        },
      ],
      meta: { limit: 200, has_more: false, next_cursor: null },
    })

    renderPanel()

    await user.click(await screen.findByRole('button', { name: /Enter replay from Task event/i }))

    expect(getTask).toHaveBeenCalledWith('t1', { as_of: '2026-04-17T11:30:00Z' })
    expect(replayState.setAsOf).toHaveBeenCalledWith('2026-04-17T11:30:00Z')
    expect(screen.getByTestId('location')).toHaveTextContent('/sites/site-task?task=t1')
  })

  it('resolves an asset event into the site asset drawer deep link at the replay timestamp', async () => {
    const user = userEvent.setup()
    const { getAuditEventsPage } = await import('../api/audit_events')
    const { getAsset } = await import('../api/assets')
    ;(getAuditEventsPage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: [
        {
          id: 'e-asset',
          schema_version: 1,
          actor: 'cmdr@example.com',
          entity_type: 'Asset',
          entity_id: 'a1',
          event_type: 'asset.status_changed',
          action: 'assigned',
          before_snapshot: null,
          after_snapshot: {},
          metadata: null,
          correlation_id: 'ca',
          occurred_at: '2026-04-17T10:45:00Z',
        },
      ],
      meta: { limit: 200, has_more: false, next_cursor: null },
    })

    renderPanel()

    await user.click(await screen.findByRole('button', { name: /Enter replay from Asset event/i }))

    expect(getAsset).toHaveBeenCalledWith('a1', { as_of: '2026-04-17T10:45:00Z' })
    expect(replayState.setAsOf).toHaveBeenCalledWith('2026-04-17T10:45:00Z')
    expect(screen.getByTestId('location')).toHaveTextContent('/sites/site-asset?asset=a1')
  })

  it('surfaces a danger toast when the reconstruction lookup fails', async () => {
    const user = userEvent.setup()
    const { getAuditEventsPage } = await import('../api/audit_events')
    const { getTask } = await import('../api/tasks')
    ;(getAuditEventsPage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: [
        {
          id: 'e-task',
          schema_version: 1,
          actor: 'op@example.com',
          entity_type: 'Task',
          entity_id: 't1',
          event_type: 'task.transitioned',
          action: 'resolved',
          before_snapshot: null,
          after_snapshot: {},
          metadata: null,
          correlation_id: 'ct',
          occurred_at: '2026-04-17T11:30:00Z',
        },
      ],
      meta: { limit: 200, has_more: false, next_cursor: null },
    })
    ;(getTask as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Task not found'))

    renderPanel()

    await user.click(await screen.findByRole('button', { name: /Enter replay from Task event/i }))

    await waitFor(() => expect(mockToasterShow).toHaveBeenCalledTimes(1))
    expect(mockToasterShow).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Task not found', intent: 'danger' }),
    )
    // Replay still enters at the event timestamp so the operator can navigate manually.
    expect(replayState.setAsOf).toHaveBeenCalledWith('2026-04-17T11:30:00Z')
    // Navigation should not happen on failure — still on /debrief.
    expect(screen.getByTestId('location')).toHaveTextContent('/debrief')
  })

  it('offers a "Show changes" action on events with field diffs and opens the diff drawer', async () => {
    const user = userEvent.setup()
    const { getAuditEventsPage } = await import('../api/audit_events')
    ;(getAuditEventsPage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: [
        {
          id: 'e-task-diff',
          schema_version: 1,
          actor: 'op@example.com',
          entity_type: 'Task',
          entity_id: 't1',
          event_type: 'task.transitioned',
          action: 'resolved',
          before_snapshot: { workflow_status: 'new' },
          after_snapshot: { workflow_status: 'resolved' },
          metadata: null,
          correlation_id: 'ct',
          occurred_at: '2026-04-17T11:30:00Z',
        },
        {
          id: 'e-empty',
          schema_version: 1,
          actor: 'cmdr@example.com',
          entity_type: 'Incident',
          entity_id: 'i1',
          event_type: 'incident.viewed',
          action: null,
          before_snapshot: null,
          after_snapshot: {},
          metadata: null,
          correlation_id: 'cv',
          occurred_at: '2026-04-17T11:00:00Z',
        },
      ],
      meta: { limit: 200, has_more: false, next_cursor: null },
    })

    renderPanel()

    // Row with a real before→after delta gets the action.
    const showChanges = await screen.findByRole('button', { name: /Show changes for Task event/i })
    // Row with no field changes does not.
    expect(screen.queryByRole('button', { name: /Show changes for Incident event/i })).not.toBeInTheDocument()

    await user.click(showChanges)

    expect(await screen.findByText('Task changes')).toBeInTheDocument()
    expect(screen.getByText('workflow status')).toBeInTheDocument()
  })

  it('ignores a stale in-flight lookup when a newer row is clicked', async () => {
    const user = userEvent.setup()
    const { getAuditEventsPage } = await import('../api/audit_events')
    const { getTask } = await import('../api/tasks')
    const { getAsset } = await import('../api/assets')

    ;(getAuditEventsPage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: [
        {
          id: 'e-task',
          schema_version: 1,
          actor: 'op@example.com',
          entity_type: 'Task',
          entity_id: 't1',
          event_type: 'task.transitioned',
          action: 'resolved',
          before_snapshot: null,
          after_snapshot: {},
          metadata: null,
          correlation_id: 'ct',
          occurred_at: '2026-04-17T11:30:00Z',
        },
        {
          id: 'e-asset',
          schema_version: 1,
          actor: 'cmdr@example.com',
          entity_type: 'Asset',
          entity_id: 'a1',
          event_type: 'asset.status_changed',
          action: 'assigned',
          before_snapshot: null,
          after_snapshot: {},
          metadata: null,
          correlation_id: 'ca',
          occurred_at: '2026-04-17T10:45:00Z',
        },
      ],
      meta: { limit: 200, has_more: false, next_cursor: null },
    })

    // Task lookup resolves later than the Asset click — it must not win navigation.
    let resolveTask: (value: unknown) => void = () => {}
    ;(getTask as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise((resolve) => { resolveTask = resolve }),
    )
    ;(getAsset as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'a1',
      name: 'Sentinel Drone',
      asset_type: 'uav',
      status: 'available',
      home_site_id: 'site-asset',
      last_reported_at: '2026-04-17T10:45:00Z',
      created_at: '2026-04-17T10:00:00Z',
      updated_at: '2026-04-17T10:45:00Z',
    })

    renderPanel()

    await user.click(await screen.findByRole('button', { name: /Enter replay from Task event/i }))
    await user.click(screen.getByRole('button', { name: /Enter replay from Asset event/i }))

    // Asset click is newer — it wins navigation and replay anchor.
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/sites/site-asset?asset=a1')
    })
    expect(replayState.setAsOf).toHaveBeenLastCalledWith('2026-04-17T10:45:00Z')

    // Resolve the stale task lookup inside act() so React flushes any state update
    // it *would* have produced before we assert. If the token guard is working, this
    // flush is a no-op on navigation and setAsOf.
    await act(async () => {
      resolveTask({
        id: 't1',
        site_id: 'site-task',
        asset_id: null,
        title: 'Resolve outage',
        description: null,
        priority: 'high',
        workflow_status: 'new',
        blocked_reason: null,
        resolved_at: null,
        created_at: '2026-04-17T11:30:00Z',
        updated_at: '2026-04-17T11:30:00Z',
        site_name: 'Task Site',
        ao_id: 'ao-1',
        ao_posture: 'defensive',
      })
    })

    // Stable-state assertion: the stale resolution never overwrites navigation or setAsOf.
    // waitFor retries the negative for its default window, catching any late scheduler flip.
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/sites/site-asset?asset=a1')
      expect(replayState.setAsOf).toHaveBeenLastCalledWith('2026-04-17T10:45:00Z')
      expect(replayState.setAsOf).not.toHaveBeenCalledWith('2026-04-17T11:30:00Z')
    })
  })

  // ── noNavigate mode (inline-on-map surface) ───────────────────────────
  describe('noNavigate mode', () => {
    it('enters replay but does NOT navigate when clicking an Incident event', async () => {
      const user = userEvent.setup()
      renderPanel({ noNavigate: true })

      await user.click(await screen.findByRole('button', { name: /Enter replay from Incident event/i }))

      expect(replayState.setAsOf).toHaveBeenCalledWith('2026-04-17T12:00:00Z')
      // Still on /debrief — no navigation side effect.
      expect(screen.getByTestId('location')).toHaveTextContent('/debrief')
    })

    it('skips the Task lookup API call entirely in noNavigate mode', async () => {
      const user = userEvent.setup()
      const { getTask } = await import('../api/tasks')
      renderPanel({ noNavigate: true })

      await user.click(await screen.findByRole('button', { name: /Enter replay from Task event/i }))

      // Replay clock still advances.
      expect(replayState.setAsOf).toHaveBeenCalledWith('2026-04-17T11:30:00Z')
      // But the reconstruction lookup is skipped — inline mode doesn't need the
      // deep-link target, so we don't pay for the round-trip.
      expect(getTask).not.toHaveBeenCalled()
      // Location unchanged.
      expect(screen.getByTestId('location')).toHaveTextContent('/debrief')
    })
  })
})
