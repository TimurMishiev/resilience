import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MEANINGFUL_DEBRIEF_EVENT_TYPES,
  useDebriefTimeline,
} from '../hooks/useDebriefTimeline'

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
  ]),
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
    const { getAuditEvents } = await import('../api/audit_events')
    renderHook(() => useDebriefTimeline({ range: '24h', nowIso: NOW }), { wrapper: createWrapper() })

    await waitFor(() => expect(getAuditEvents).toHaveBeenCalledTimes(1))
    const call = (getAuditEvents as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.event_types).toEqual(MEANINGFUL_DEBRIEF_EVENT_TYPES)
    expect(call.limit).toBe(200)
    expect(new Date(call.from).toISOString()).toBe('2026-04-16T12:00:00.000Z')
  })

  it('uses 1h window for range=1h', async () => {
    const { getAuditEvents } = await import('../api/audit_events')
    renderHook(() => useDebriefTimeline({ range: '1h', nowIso: NOW }), { wrapper: createWrapper() })
    await waitFor(() => expect(getAuditEvents).toHaveBeenCalledTimes(1))
    const call = (getAuditEvents as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(new Date(call.from).toISOString()).toBe('2026-04-17T11:00:00.000Z')
  })

  it('uses 7 day window for range=7d', async () => {
    const { getAuditEvents } = await import('../api/audit_events')
    renderHook(() => useDebriefTimeline({ range: '7d', nowIso: NOW }), { wrapper: createWrapper() })
    await waitFor(() => expect(getAuditEvents).toHaveBeenCalledTimes(1))
    const call = (getAuditEvents as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(new Date(call.from).toISOString()).toBe('2026-04-10T12:00:00.000Z')
  })

  it('does not fetch when disabled', async () => {
    const { getAuditEvents } = await import('../api/audit_events')
    renderHook(() => useDebriefTimeline({ range: '24h', enabled: false, nowIso: NOW }), { wrapper: createWrapper() })
    // Give React Query a tick to decide not to fire
    await new Promise((r) => setTimeout(r, 0))
    expect(getAuditEvents).not.toHaveBeenCalled()
  })

  it('returns data from getAuditEvents', async () => {
    const { result } = renderHook(() => useDebriefTimeline({ range: '6h', nowIso: NOW }), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.data?.length).toBe(1))
    expect(result.current.data?.[0].event_type).toBe('incident.opened')
  })
})
