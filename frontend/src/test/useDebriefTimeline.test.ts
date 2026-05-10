import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MEANINGFUL_DEBRIEF_EVENT_TYPES,
  useDebriefTimeline,
} from '../hooks/useDebriefTimeline'

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
    ],
    meta: {
      limit: 200,
      has_more: false,
      next_cursor: null,
    },
  }),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

const NOW = '2026-04-17T12:00:00Z'

describe('useDebriefTimeline', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('requests curated event types and computes from based on range', async () => {
    const { getAuditEventsPage } = await import('../api/audit_events')
    renderHook(() => useDebriefTimeline({ range: '24h', nowIso: NOW }), { wrapper: createWrapper() })

    await waitFor(() => expect(getAuditEventsPage).toHaveBeenCalledTimes(1))
    const call = (getAuditEventsPage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.event_types).toEqual(MEANINGFUL_DEBRIEF_EVENT_TYPES)
    expect(call.limit).toBe(200)
    expect(new Date(call.from).toISOString()).toBe('2026-04-16T12:00:00.000Z')
    expect(call.to).toBe(NOW)
  })

  it('uses 1h window for range=1h', async () => {
    const { getAuditEventsPage } = await import('../api/audit_events')
    renderHook(() => useDebriefTimeline({ range: '1h', nowIso: NOW }), { wrapper: createWrapper() })
    await waitFor(() => expect(getAuditEventsPage).toHaveBeenCalledTimes(1))
    const call = (getAuditEventsPage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(new Date(call.from).toISOString()).toBe('2026-04-17T11:00:00.000Z')
  })

  it('uses 7 day window for range=7d', async () => {
    const { getAuditEventsPage } = await import('../api/audit_events')
    renderHook(() => useDebriefTimeline({ range: '7d', nowIso: NOW }), { wrapper: createWrapper() })
    await waitFor(() => expect(getAuditEventsPage).toHaveBeenCalledTimes(1))
    const call = (getAuditEventsPage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(new Date(call.from).toISOString()).toBe('2026-04-10T12:00:00.000Z')
  })

  it('does not fetch when disabled', async () => {
    const { getAuditEventsPage } = await import('../api/audit_events')
    renderHook(() => useDebriefTimeline({ range: '24h', enabled: false, nowIso: NOW }), { wrapper: createWrapper() })
    // Give React Query a tick to decide not to fire
    await new Promise((r) => setTimeout(r, 0))
    expect(getAuditEventsPage).not.toHaveBeenCalled()
  })

  it('returns data from getAuditEvents', async () => {
    const { result } = renderHook(() => useDebriefTimeline({ range: '6h', nowIso: NOW }), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.events.length).toBe(1))
    expect(result.current.events[0].event_type).toBe('incident.opened')
  })

  it('fetches the next page when a cursor is returned', async () => {
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
            before_sequence: 42,
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
            occurred_at: '2026-04-17T11:30:00Z',
          },
        ],
        meta: {
          limit: 200,
          has_more: false,
          next_cursor: null,
        },
      })

    const { result } = renderHook(() => useDebriefTimeline({ range: '24h', nowIso: NOW }), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.events.length).toBe(1))
    expect(result.current.hasMore).toBe(true)

    await result.current.loadMore()

    await waitFor(() => expect(result.current.events.map((event) => event.id)).toEqual(['e1', 'e0']))
    const secondCall = (getAuditEventsPage as ReturnType<typeof vi.fn>).mock.calls[1][0]
    expect(secondCall.to).toBe(NOW)
    expect(secondCall.before_occurred_at).toBe('2026-04-17T12:00:00.000000Z')
    expect(secondCall.before_sequence).toBe(42)
    expect(secondCall.before_id).toBe('e1')
  })
})
