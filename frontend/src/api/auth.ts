import { api, setToken, clearToken } from './client'

export type UserRole = 'operator' | 'commander'

export interface CurrentUser {
  id: string
  email: string
  role: UserRole
}

interface LoginResponse {
  token: string
  user: CurrentUser
}

export async function login(email: string, password: string): Promise<{ token: string; user: CurrentUser }> {
  const res = await api.post<LoginResponse>('/api/auth/login', { session: { email, password } })
  setToken(res.token)
  return res
}

export function logout(): void {
  clearToken()
}
