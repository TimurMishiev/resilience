// ---------------------------------------------------------------------------
// Base API client — thin fetch wrapper, no external dependencies
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  public readonly status: number
  public readonly body: unknown

  constructor(
    status: number,
    body: unknown,
    message: string,
  ) {
    super(message)
    this.status = status
    this.body = body
    this.name = 'ApiError'
  }
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>

// ---------------------------------------------------------------------------
// Token storage — simple localStorage slot; AuthContext reads/writes this
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'resilience_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

// ---------------------------------------------------------------------------
// 401 callback — AuthContext registers this so it can clear state on expiry
// ---------------------------------------------------------------------------

let onUnauthorized: (() => void) | null = null

export function registerUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn
}

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

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

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  const token = getToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const init: RequestInit = { method, headers }

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

  if (res.status === 401) {
    onUnauthorized?.()
    throw new ApiError(res.status, payload, `Unauthorized`)
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
