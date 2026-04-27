import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditEvent, Site } from '../api/types'
import { useReplayEventPulses } from '../hooks/useReplayEventPulses'

const getAuditEventsMock = vi.fn<(params?: unknown) => Promise<AuditEvent[]>>()

vi.mock('../api/audit_events', () => ({
  getAuditEvents: (params?: unknown) => getAuditEventsMock(params),
  getAuditEventsPage: vi.fn(),
}))

function makeSite(id: string, lat = 10, lng = 20): Site {
  return {
    id,
    name: `Site ${id}`,
    latitude: lat,
    longitude: lng,
    status: 'active',
    area_of_operation_id: null,
    flagged_at: null,
    flag_reason: null,
    geofence_radius_km: 5,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'evt-1',
    schema_version: 1,
    actor: 'system',
    entity_type: 'Site',
    entity_id: 'site-a',
    event_type: 'site_flagged',
    action: null,
    before_snapshot: null,
    after_snapshot: {},
    metadata: null,
    correlation_id: 'corr-1',
    occurred_at: '2026-04-26T12:00:00.000Z',
    ...overrides,
  } as AuditEvent
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  getAuditEventsMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useReplayEventPulses', () => {
  it('returns [] in live mode and never fetches', () => {
    const { result } = renderHook(
      () => useReplayEventPulses({ asOf: null, isReplaying: false, sites: [makeSite('site-a')] }),
      { wrapper: createWrapper() },
    )
    expect(result.current).toEqual([])
    expect(getAuditEventsMock).not.toHaveBeenCalled()
  })

  it('returns [] in replay mode when asOf is null', () => {
    const { result } = renderHook(
      () => useReplayEventPulses({ asOf: null, isReplaying: true, sites: [makeSite('site-a')] }),
      { wrapper: createWrapper() },
    )
    expect(result.current).toEqual([])
    expect(getAuditEventsMock).not.toHaveBeenCalled()
  })

  it('fetches with the high-signal event_types list and returns resolved pulses while replaying', async () => {
    getAuditEventsMock.mockResolvedValue([
      makeEvent({ id: 'e1', entity_type: 'Site', entity_id: 'site-a' }),
    ])

    const { result } = renderHook(
      () =>
        useReplayEventPulses({
          asOf: '2026-04-26T12:00:00.000Z',
          isReplaying: true,
          sites: [makeSite('site-a', 12.34, -56.78)],
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current).toHaveLength(1))

    expect(result.current[0]).toMatchObject({
      id: 'e1',
      lat: 12.34,
      lng: -56.78,
      eventType: 'site_flagged',
      intensity: 1,
    })

    expect(getAuditEventsMock).toHaveBeenCalledTimes(1)
    const params = getAuditEventsMock.mock.calls[0][0] as Record<string, unknown>
    expect(params.event_types).toEqual([
      'site_flagged',
      'incident.opened',
      'incident_transitioned',
      'task.transitioned',
      'prosecution_started',
    ])
    // Past-only window: `to` clamps at the bucketed cursor (≤ asOf so
    // the server's `occurred_at desc` ordering can never let
    // forward-speculative rows crowd out the visible past). `from` is
    // a full PULSE_WINDOW_MS earlier.
    const asOfMs = Date.parse('2026-04-26T12:00:00.000Z')
    expect(typeof params.from).toBe('string')
    expect(typeof params.to).toBe('string')
    expect(Date.parse(params.to as string)).toBeLessThanOrEqual(asOfMs)
    expect(Date.parse(params.from as string)).toBeLessThan(Date.parse(params.to as string))
    // `as_of` is no longer sent — past-only filtering is enforced
    // client-side in buildPulses, so the server response order can
    // be relied on without an extra cursor clip.
    expect(params.as_of).toBeUndefined()
  })

  it('does not refetch when the cursor advances within the same bucket', async () => {
    getAuditEventsMock.mockResolvedValue([])

    const { rerender } = renderHook(
      ({ asOf }: { asOf: string }) =>
        useReplayEventPulses({
          asOf,
          isReplaying: true,
          sites: [makeSite('site-a')],
        }),
      {
        wrapper: createWrapper(),
        // 12:00:00 — bucket-aligned to 12:00 (CURSOR_BUCKET_MS = 2.5 min).
        initialProps: { asOf: '2026-04-26T12:00:00.000Z' },
      },
    )

    await waitFor(() => expect(getAuditEventsMock).toHaveBeenCalledTimes(1))

    // Advance within the [12:00, 12:02:30) bucket — no new fetch.
    rerender({ asOf: '2026-04-26T12:01:00.000Z' })
    rerender({ asOf: '2026-04-26T12:02:00.000Z' })

    expect(getAuditEventsMock).toHaveBeenCalledTimes(1)

    // Cross the bucket boundary at 12:02:30 — new fetch fires.
    rerender({ asOf: '2026-04-26T12:03:00.000Z' })

    await waitFor(() => expect(getAuditEventsMock).toHaveBeenCalledTimes(2))
  })

  it('never asks the server for events newer than the cursor (past-only fetch shape)', async () => {
    // Density-starvation guard (Codex round-3 P2): the server orders
    // events `occurred_at desc` and caps at `limit`. If we ever asked
    // for a window extending past the cursor, a dense burst in the
    // forward portion could consume the budget and leave the visible
    // past empty. This test asserts the contract: `to` ≤ bucketed
    // cursor, never beyond.
    getAuditEventsMock.mockResolvedValue([])

    renderHook(
      () =>
        useReplayEventPulses({
          asOf: '2026-04-26T12:01:30.000Z',
          isReplaying: true,
          sites: [makeSite('site-a')],
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(getAuditEventsMock).toHaveBeenCalledTimes(1))
    const params = getAuditEventsMock.mock.calls[0][0] as Record<string, unknown>
    const cursorMs = Date.parse('2026-04-26T12:01:30.000Z')
    expect(Date.parse(params.to as string)).toBeLessThanOrEqual(cursorMs)
  })

  it('drops events for sites not in the loaded sites list (e.g. cross-org)', async () => {
    getAuditEventsMock.mockResolvedValue([
      makeEvent({ id: 'visible', entity_id: 'site-a' }),
      makeEvent({ id: 'foreign', entity_id: 'site-foreign' }),
    ])

    const { result } = renderHook(
      () =>
        useReplayEventPulses({
          asOf: '2026-04-26T12:00:00.000Z',
          isReplaying: true,
          sites: [makeSite('site-a')],
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(result.current[0]?.id).toBe('visible')
  })
})
