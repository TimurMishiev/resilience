// ---------------------------------------------------------------------------
// Base API client — thin fetch wrapper, no external dependencies
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type QueryParams = Record<string, string | number | boolean | undefined | null>

function buildUrl(path: string, params?: QueryParams): string {
  const url = new URL(path, window.location.origin)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    }
  }
  return url.pathname + url.search
}

async function request<T>(
  method: string,
  path: string,
  options: { params?: QueryParams; body?: unknown } = {},
): Promise<T> {
  const url = buildUrl(path, options.params)

  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  }

  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body)
  }

  const res = await fetch(url, init)

  let payload: unknown
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    payload = await res.json()
  } else {
    payload = await res.text()
  }

  if (!res.ok) {
    throw new ApiError(res.status, payload, `API ${method} ${path} → ${res.status}`)
  }

  return payload as T
}

export const api = {
  get<T>(path: string, params?: QueryParams): Promise<T> {
    return request<T>('GET', path, { params })
  },

  post<T>(path: string, body: unknown): Promise<T> {
    return request<T>('POST', path, { body })
  },

  put<T>(path: string, body: unknown): Promise<T> {
    return request<T>('PUT', path, { body })
  },
}
