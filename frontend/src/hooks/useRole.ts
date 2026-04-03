import { useAuth } from '../context/AuthContext'

export type UserRole = 'viewer' | 'commander' | 'operator' | 'admin'

export function useRole() {
  const { currentUser } = useAuth()
  const role = (currentUser?.role ?? 'viewer') as UserRole
  return {
    role,
    isAdmin:     role === 'admin',
    isCommander: role === 'commander' || role === 'admin',
    isOperator:  role === 'operator',
    isViewer:    role === 'viewer',
  }
}
