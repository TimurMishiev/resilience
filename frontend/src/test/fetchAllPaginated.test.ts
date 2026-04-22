import { describe, expect, it, vi } from 'vitest'
import { fetchAllPaginated } from '../hooks/fetchAllPaginated'

describe('fetchAllPaginated', () => {
  it('requests every page and returns one aggregated response', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({
        data: [{ id: 'site-1' }, { id: 'site-2' }],
        meta: { total: 3, page: 1, per_page: 200, total_pages: 2 },
      })
      .mockResolvedValueOnce({
        data: [{ id: 'site-3' }],
        meta: { total: 3, page: 2, per_page: 200, total_pages: 2 },
      })

    const result = await fetchAllPaginated(fetchPage, { as_of: '2026-04-21T00:00:00.000Z' })

    expect(fetchPage).toHaveBeenNthCalledWith(1, {
      as_of: '2026-04-21T00:00:00.000Z',
      page: 1,
      per_page: 200,
    }, undefined)
    expect(fetchPage).toHaveBeenNthCalledWith(2, {
      as_of: '2026-04-21T00:00:00.000Z',
      page: 2,
      per_page: 200,
    }, undefined)
    expect(result).toEqual({
      data: [{ id: 'site-1' }, { id: 'site-2' }, { id: 'site-3' }],
      meta: { total: 3, page: 1, per_page: 3, total_pages: 2 },
    })
  })

  it('returns a single-page empty response without iterating', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({
      data: [],
      meta: { total: 0, page: 1, per_page: 200, total_pages: 1 },
    })

    const result = await fetchAllPaginated(fetchPage)

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      data: [],
      meta: { total: 0, page: 1, per_page: 0, total_pages: 1 },
    })
  })

  it('requests remaining pages in parallel after the first page resolves', async () => {
    let resolvePage2: ((value: { data: Array<{ id: string }>; meta: { total: number; page: number; per_page: number; total_pages: number } }) => void) | undefined
    let resolvePage3: ((value: { data: Array<{ id: string }>; meta: { total: number; page: number; per_page: number; total_pages: number } }) => void) | undefined

    const fetchPage = vi.fn().mockImplementation(({ page }: { page: number }) => {
      if (page === 1) {
        return Promise.resolve({
          data: [{ id: 'site-1' }],
          meta: { total: 3, page: 1, per_page: 200, total_pages: 3 },
        })
      }

      if (page === 2) {
        return new Promise((resolve) => {
          resolvePage2 = resolve
        })
      }

      return new Promise((resolve) => {
        resolvePage3 = resolve
      })
    })

    const resultPromise = fetchAllPaginated(fetchPage)
    await Promise.resolve()

    expect(fetchPage).toHaveBeenCalledTimes(3)
    expect(fetchPage).toHaveBeenNthCalledWith(2, { page: 2, per_page: 200 }, undefined)
    expect(fetchPage).toHaveBeenNthCalledWith(3, { page: 3, per_page: 200 }, undefined)

    resolvePage3?.({
      data: [{ id: 'site-3' }],
      meta: { total: 3, page: 3, per_page: 200, total_pages: 3 },
    })
    resolvePage2?.({
      data: [{ id: 'site-2' }],
      meta: { total: 3, page: 2, per_page: 200, total_pages: 3 },
    })

    await expect(resultPromise).resolves.toEqual({
      data: [{ id: 'site-1' }, { id: 'site-2' }, { id: 'site-3' }],
      meta: { total: 3, page: 1, per_page: 3, total_pages: 3 },
    })
  })

  it('caps in-flight page requests at the concurrency limit', async () => {
    const MAX_CONCURRENT = 6
    const totalPages = 12
    const resolvers = new Map<number, (value: { data: Array<{ id: string }>; meta: { total: number; page: number; per_page: number; total_pages: number } }) => void>()
    let inFlight = 0
    let peakInFlight = 0

    const fetchPage = vi.fn().mockImplementation(({ page }: { page: number }) => {
      if (page === 1) {
        return Promise.resolve({
          data: [{ id: 'site-1' }],
          meta: { total: totalPages, page: 1, per_page: 200, total_pages: totalPages },
        })
      }

      inFlight += 1
      peakInFlight = Math.max(peakInFlight, inFlight)
      return new Promise<{ data: Array<{ id: string }>; meta: { total: number; page: number; per_page: number; total_pages: number } }>((resolve) => {
        resolvers.set(page, (value) => {
          inFlight -= 1
          resolve(value)
        })
      })
    })

    const resultPromise = fetchAllPaginated(fetchPage)

    for (let tick = 0; tick < 30; tick += 1) {
      await Promise.resolve()
      if (resolvers.size >= MAX_CONCURRENT) break
    }

    expect(peakInFlight).toBe(MAX_CONCURRENT)
    expect(fetchPage).toHaveBeenCalledTimes(1 + MAX_CONCURRENT)

    for (let page = 2; page <= totalPages; page += 1) {
      while (!resolvers.has(page)) {
        await Promise.resolve()
      }
      resolvers.get(page)!({
        data: [{ id: `site-${page}` }],
        meta: { total: totalPages, page, per_page: 200, total_pages: totalPages },
      })
    }

    const result = await resultPromise

    expect(peakInFlight).toBe(MAX_CONCURRENT)
    expect(fetchPage).toHaveBeenCalledTimes(totalPages)
    expect((result.data as Array<{ id: string }>).map((row) => row.id)).toEqual(
      Array.from({ length: totalPages }, (_, index) => `site-${index + 1}`),
    )
  })

  it('throws if a later page reports different total_pages metadata', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({
        data: [{ id: 'site-1' }],
        meta: { total: 2, page: 1, per_page: 200, total_pages: 2 },
      })
      .mockResolvedValueOnce({
        data: [{ id: 'site-2' }],
        meta: { total: 2, page: 2, per_page: 200, total_pages: 3 },
      })

    await expect(fetchAllPaginated(fetchPage)).rejects.toThrow(
      'Paginated response metadata drifted while fetching page 2: expected total_pages=2, received 3',
    )
  })

  it('propagates later page failures', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({
        data: [{ id: 'site-1' }],
        meta: { total: 2, page: 1, per_page: 200, total_pages: 2 },
      })
      .mockRejectedValueOnce(new Error('page 2 failed'))

    await expect(fetchAllPaginated(fetchPage)).rejects.toThrow('page 2 failed')
  })

  it('forwards the abort signal to every page request', async () => {
    const controller = new AbortController()
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({
        data: [{ id: 'site-1' }],
        meta: { total: 2, page: 1, per_page: 200, total_pages: 2 },
      })
      .mockResolvedValueOnce({
        data: [{ id: 'site-2' }],
        meta: { total: 2, page: 2, per_page: 200, total_pages: 2 },
      })

    await fetchAllPaginated(fetchPage, undefined, { signal: controller.signal })

    expect(fetchPage).toHaveBeenNthCalledWith(1, { page: 1, per_page: 200 }, { signal: controller.signal })
    expect(fetchPage).toHaveBeenNthCalledWith(2, { page: 2, per_page: 200 }, { signal: controller.signal })
  })
})
