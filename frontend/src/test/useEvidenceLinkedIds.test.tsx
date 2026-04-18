import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SignalRuleMatch } from '../api/types'
import { useEvidenceLinkedIds } from '../hooks/useEvidenceLinkedIds'

vi.mock('../api/signal_rule_matches', () => ({
  getSignalRuleMatches: vi.fn(),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

function buildMatch({
  id,
  signalId = null,
  siteId = null,
}: {
  id: string
  signalId?: string | null
  siteId?: string | null
}): SignalRuleMatch {
  return {
    id,
    fired_at: '2026-03-24T12:00:00.000Z',
    confidence: 0.9,
    workflow_status: 'unacknowledged',
    acknowledged_at: null,
    acknowledged_by: null,
    notes: null,
    metadata: {},
    signal: signalId ? {
      id: signalId,
      source: 'gdacs',
      signal_type: 'disaster_alert',
      lat: 10,
      lng: 20,
      occurred_at: '2026-03-24T11:59:00.000Z',
    } : null,
    correlation_rule: { id: 'rule-1', name: 'Rule One' },
    site: siteId ? { id: siteId, name: `Site ${siteId}` } : null,
    task: null,
  }
}

describe('useEvidenceLinkedIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches all site-linked match pages and forwards as_of during replay', async () => {
    const { getSignalRuleMatches } = await import('../api/signal_rule_matches')

    vi.mocked(getSignalRuleMatches)
      .mockResolvedValueOnce({
        data: [
          buildMatch({ id: 'm-1', signalId: 'sig-1' }),
          buildMatch({ id: 'm-2', signalId: 'sig-2' }),
          buildMatch({ id: 'm-3', signalId: 'sig-1' }),
        ],
        meta: { total: 4, page: 1, per_page: 100, total_pages: 2 },
      })
      .mockResolvedValueOnce({
        data: [buildMatch({ id: 'm-4', signalId: 'sig-3' })],
        meta: { total: 4, page: 2, per_page: 100, total_pages: 2 },
      })

    const { result } = renderHook(
      () => useEvidenceLinkedIds('site-1', null, '2026-03-24T12:00:00.000Z'),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.evidenceSignalIds).toEqual(['sig-1', 'sig-2', 'sig-3']))

    expect(getSignalRuleMatches).toHaveBeenNthCalledWith(1, {
      site_id: 'site-1',
      as_of: '2026-03-24T12:00:00.000Z',
      page: 1,
      per_page: 100,
    })
    expect(getSignalRuleMatches).toHaveBeenNthCalledWith(2, {
      site_id: 'site-1',
      as_of: '2026-03-24T12:00:00.000Z',
      page: 2,
      per_page: 100,
    })
  })

  it('fetches all signal-linked match pages and dedupes linked sites', async () => {
    const { getSignalRuleMatches } = await import('../api/signal_rule_matches')

    vi.mocked(getSignalRuleMatches)
      .mockResolvedValueOnce({
        data: [
          buildMatch({ id: 'm-1', siteId: 'site-a' }),
          buildMatch({ id: 'm-2', siteId: 'site-b' }),
        ],
        meta: { total: 4, page: 1, per_page: 100, total_pages: 2 },
      })
      .mockResolvedValueOnce({
        data: [
          buildMatch({ id: 'm-3', siteId: 'site-a' }),
          buildMatch({ id: 'm-4', siteId: 'site-c' }),
        ],
        meta: { total: 4, page: 2, per_page: 100, total_pages: 2 },
      })

    const { result } = renderHook(
      () => useEvidenceLinkedIds(null, 'sig-9', null),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.evidenceSiteIds).toEqual(['site-a', 'site-b', 'site-c']))

    expect(getSignalRuleMatches).toHaveBeenNthCalledWith(1, {
      signal_id: 'sig-9',
      page: 1,
      per_page: 100,
    })
    expect(getSignalRuleMatches).toHaveBeenNthCalledWith(2, {
      signal_id: 'sig-9',
      page: 2,
      per_page: 100,
    })
  })

  it('does not query when there is no selected site or signal', async () => {
    const { getSignalRuleMatches } = await import('../api/signal_rule_matches')

    const { result } = renderHook(
      () => useEvidenceLinkedIds(null, null, '2026-03-24T12:00:00.000Z'),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current).toEqual({
      evidenceSignalIds: [],
      evidenceSiteIds: [],
    }))

    expect(getSignalRuleMatches).not.toHaveBeenCalled()
  })
})
