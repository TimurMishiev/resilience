import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { registerUnauthorizedHandler, getToken } from '../api/client'
import { logout as apiLogout } from '../api/auth'
import type { CurrentUser } from '../api/auth'

// Decode the JWT payload to restore user from localStorage on page load
function decodeTokenPayload(token: string): CurrentUser | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    if (!payload.sub || !payload.email || !payload.role) return null
    return { id: payload.sub, email: payload.email, role: payload.role }
  } catch {
    return null
  }
}

interface AuthContextValue {
  currentUser: CurrentUser | null
  isAuthenticated: boolean
  login: (user: CurrentUser) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() => {
    const token = getToken()
    return token ? decodeTokenPayload(token) : null
  })

  function handleLogout() {
    apiLogout()
    setCurrentUser(null)
  }

  function handleLogin(user: CurrentUser) {
    setCurrentUser(user)
  }

  // Register the 401 handler so expired tokens automatically log out
  useEffect(() => {
    registerUnauthorizedHandler(handleLogout)
  }, [])

  return (
    <AuthContext.Provider value={{
      currentUser,
      isAuthenticated: currentUser !== null,
      login: handleLogin,
      logout: handleLogout,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
