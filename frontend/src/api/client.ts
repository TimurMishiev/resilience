// ---------------------------------------------------------------------------
// Base API client — thin fetch wrapper, no external dependencies
// ---------------------------------------------------------------------------

import { AppToaster } from '../lib/toaster'

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

type QueryParamScalar = string | number | boolean
export type QueryParamValue =
  | QueryParamScalar
  | QueryParamScalar[]
  | undefined
  | null
export type QueryParams = Record<string, QueryParamValue>

function extractApiMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim().length > 0) {
    return body.trim()
  }

  if (Array.isArray(body)) {
    const messages = body.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    return messages.length > 0 ? messages.join(', ') : fallback
  }

  if (!body || typeof body !== 'object') {
    return fallback
  }

  const payload = body as Record<string, unknown>

  if (Array.isArray(payload.errors)) {
    const messages = payload.errors.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    if (messages.length > 0) return messages.join(', ')
  }

  if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
    return payload.error.trim()
  }

  if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
    return payload.message.trim()
  }

  return fallback
}

export function getApiErrorMessage(error: unknown, fallback = 'Request failed'): string {
  if (error instanceof ApiError) {
    return extractApiMessage(error.body, error.message || fallback)
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return fallback
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
// credentials: 'include' sends the httpOnly _resilience_session cookie
// automatically on every request — no Authorization header needed for browsers.
// The server still accepts Authorization: Bearer <token> for API clients / tests.
// ---------------------------------------------------------------------------

function buildUrl(path: string, params?: QueryParams): string {
  const url = new URL(path, window.location.origin)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          value.forEach((item) => url.searchParams.append(`${key}[]`, String(item)))
        } else {
          url.searchParams.set(key, String(value))
        }
      }
    }
  }
  return url.pathname + url.search
}

const DEFAULT_TIMEOUT_MS = 30_000

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

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  const init: RequestInit = { method, headers, credentials: 'include', signal: controller.signal }

  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body)
  }

  let res: Response
  try {
    res = await fetch(url, init)
  } finally {
    clearTimeout(timeoutId)
  }

  let payload: unknown
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    payload = await res.json()
  } else {
    payload = await res.text()
  }

  if (res.status === 401) {
    onUnauthorized?.()
    throw new ApiError(res.status, payload, extractApiMessage(payload, 'Unauthorized'))
  }

  if (res.status === 429) {
    void AppToaster.then((t) =>
      t.show({
        message: 'Too many requests — please wait a moment and retry.',
        intent: 'warning',
        icon: 'time',
        timeout: 5000,
      }),
    )
    throw new ApiError(res.status, payload, extractApiMessage(payload, 'Rate limited'))
  }

  if (!res.ok) {
    throw new ApiError(res.status, payload, extractApiMessage(payload, `API ${method} ${path} → ${res.status}`))
  }

  return payload as T
}

// ---------------------------------------------------------------------------
// Raw blob POST — used for endpoints that return binary (e.g. PDF export).
// Bypasses the JSON parsing in request() and returns the raw Response Blob.
// ---------------------------------------------------------------------------

export async function postBlob(path: string, body: unknown, accept = '*/*'): Promise<Blob> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: accept,
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 120_000) // PDF exports can be slow

  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }

  if (res.status === 401) {
    onUnauthorized?.()
    throw new ApiError(res.status, null, 'Unauthorized')
  }

  if (res.status === 429) {
    void AppToaster.then((t) =>
      t.show({
        message: 'Too many requests — please wait a moment and retry.',
        intent: 'warning',
        icon: 'time',
        timeout: 5000,
      }),
    )
    throw new ApiError(res.status, null, 'Rate limited')
  }

  if (!res.ok) {
    // Try to read JSON error body for a useful message
    let errBody: unknown
    try { errBody = await res.json() } catch { errBody = null }
    throw new ApiError(res.status, errBody, extractApiMessage(errBody, `API POST ${path} → ${res.status}`))
  }

  return res.blob()
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

  patch<T>(path: string, body: unknown): Promise<T> {
    return request<T>('PATCH', path, { body })
  },

  delete<T = void>(path: string, params?: QueryParams): Promise<T> {
    return request<T>('DELETE', path, { params })
  },
}
