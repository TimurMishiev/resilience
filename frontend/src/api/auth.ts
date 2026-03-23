import { api } from './client'

export type UserRole = 'operator' | 'commander'

export interface CurrentUser {
  id: string
  email: string
  role: UserRole
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

export async function logout(): Promise<void> {
  try {
    await api.delete('/api/auth/logout')
  } catch {
    // Proceed with local logout even if the server request fails
  }
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
