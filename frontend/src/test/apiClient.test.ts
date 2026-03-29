import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSwimlane } from '../api/readiness'

describe('api client array params', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('encodes array params with [] keys for analytics queries', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ data: [], meta: { days: 3, lane_limit: 8, lane_count: 0, total_events: 0, event_kinds: [], selected_site_ids: [] } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await getSwimlane({
      days: 3,
      kinds: ['rule_fired', 'task_created'],
      site_ids: ['site-1', 'site-2'],
    })

    const url = fetchMock.mock.calls[0]?.[0] as string
    expect(url).toContain('/api/analytics/swimlane?')
    expect(url).toContain('kinds%5B%5D=rule_fired')
    expect(url).toContain('kinds%5B%5D=task_created')
    expect(url).toContain('site_ids%5B%5D=site-1')
    expect(url).toContain('site_ids%5B%5D=site-2')
  })
})
