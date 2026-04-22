import type { PaginatedResponse, PaginationMeta, PaginationParams } from '../api/types'

const MAX_PER_PAGE = 200
const MAX_CONCURRENT_PAGES = 6

type FetchAllPaginatedOptions = {
  signal?: AbortSignal
}

function aggregateMeta(meta: PaginationMeta, count: number): PaginationMeta {
  return {
    total: meta.total,
    page: 1,
    per_page: count,
    total_pages: meta.total_pages,
  }
}

export async function fetchAllPaginated<T, P extends PaginationParams>(
  fetchPage: (params?: P, options?: FetchAllPaginatedOptions) => Promise<PaginatedResponse<T>>,
  params?: Omit<P, 'page' | 'per_page'>,
  options?: FetchAllPaginatedOptions,
): Promise<PaginatedResponse<T>> {
  const first = await fetchPage({ ...(params ?? {}), page: 1, per_page: MAX_PER_PAGE } as P, options)
  if (first.meta.total_pages <= 1) {
    return {
      data: first.data,
      meta: aggregateMeta(first.meta, first.data.length),
    }
  }

  const data = [...first.data]
  const remainingPages = Array.from(
    { length: first.meta.total_pages - 1 },
    (_, index) => index + 2,
  )

  const responsesByPage = new Map<number, PaginatedResponse<T>>()
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= remainingPages.length) return
      const page = remainingPages[index]
      const response = await fetchPage(
        { ...(params ?? {}), page, per_page: MAX_PER_PAGE } as P,
        options,
      )
      responsesByPage.set(page, response)
    }
  }

  const workerCount = Math.min(MAX_CONCURRENT_PAGES, remainingPages.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  for (const page of remainingPages) {
    const response = responsesByPage.get(page)!
    if (response.meta.total_pages !== first.meta.total_pages) {
      throw new Error(
        `Paginated response metadata drifted while fetching page ${page}: expected total_pages=${first.meta.total_pages}, received ${response.meta.total_pages}`,
      )
    }

    if (response.meta.page !== page) {
      throw new Error(
        `Paginated response returned page ${response.meta.page} while requesting page ${page}`,
      )
    }

    data.push(...response.data)
  }

  return {
    data,
    meta: aggregateMeta(first.meta, data.length),
  }
}
