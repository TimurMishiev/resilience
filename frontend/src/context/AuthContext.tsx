import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { registerUnauthorizedHandler } from '../api/client'
import { logout as apiLogout, restoreUser } from '../api/auth'
import type { CurrentUser } from '../api/auth'

interface AuthContextValue {
  currentUser: CurrentUser | null
  isAuthenticated: boolean
  login: (user: CurrentUser) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  // Restore from sessionStorage on page load — user info only, never the token.
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() => restoreUser())

  function handleLogout() {
    apiLogout()
    setCurrentUser(null)
  }

  function handleLogin(user: CurrentUser) {
    setCurrentUser(user)
  }

  // Register the 401 handler so expired cookies automatically log out
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
