import { api, type QueryParamValue } from './client'

export type UserRole = 'viewer' | 'operator' | 'commander' | 'admin'

export interface CurrentUser {
  id: string
  email: string
  role: UserRole
  organization_id?: string | null
  area_of_operation_id?: string | null
}

const USER_KEY = 'resilience_user'

export async function login(email: string, password: string): Promise<{ user: CurrentUser }> {
  // Server sets an httpOnly _resilience_session cookie and returns only user metadata.
  const res = await api.post<{ user: CurrentUser }>('/api/auth/login', { session: { email, password } })
  // Store user info (not the token) in sessionStorage for page-refresh restoration.
  // sessionStorage is tab-scoped and cleared when the session ends — the token
  // itself never touches JS-accessible storage.
  sessionStorage.setItem(USER_KEY, JSON.stringify(res.user))
  return res
}

export async function logout(options?: { allSessions?: boolean; suppressErrors?: boolean }): Promise<void> {
  try {
    await api.delete('/api/auth/logout', options?.allSessions ? { all_sessions: true } : undefined)
  } catch (error) {
    if (options?.suppressErrors == false) {
      throw error
    }

    // Proceed with local logout even if the server request fails
    clearStoredUser()
    return
  }

  clearStoredUser()
}

export interface UserSessionRecord {
  id: string
  user_id: string
  user_email: string
  current: boolean
  ip_address: string | null
  user_agent: string | null
  last_seen_at: string
  created_at: string
  expires_at: string
  revoked_at: string | null
  revoke_reason: string | null
  revoked_by_email: string | null
}

export interface UserSessionsResponse {
  data: UserSessionRecord[]
  meta: {
    user_id: string
    user_email: string
  }
}

export interface UserSessionQueryParams {
  [key: string]: QueryParamValue
  user_id?: string
  user_email?: string
}

export interface RevokeAllSessionsParams extends UserSessionQueryParams {
  keep_current?: boolean
}

export async function getUserSessions(params?: UserSessionQueryParams): Promise<UserSessionsResponse> {
  return api.get<UserSessionsResponse>('/api/auth/sessions', params)
}

export async function revokeUserSession(id: string, params?: UserSessionQueryParams): Promise<void> {
  await api.delete(`/api/auth/sessions/${id}`, params)
}

export async function revokeAllUserSessions(params?: RevokeAllSessionsParams): Promise<void> {
  await api.delete('/api/auth/sessions', {
    all: true,
    ...(params?.keep_current !== undefined ? { keep_current: params.keep_current } : {}),
    ...(params?.user_id ? { user_id: params.user_id } : {}),
    ...(params?.user_email ? { user_email: params.user_email } : {}),
  })
}

export function clearStoredUser(): void {
  sessionStorage.removeItem(USER_KEY)
}

/** Restore user from sessionStorage on page load (no token decode needed). */
export function restoreUser(): CurrentUser | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY)
    if (!raw) return null
    const user = JSON.parse(raw) as CurrentUser
    if (!user.id || !user.email || !user.role) return null
    return user
  } catch {
    return null
  }
}
