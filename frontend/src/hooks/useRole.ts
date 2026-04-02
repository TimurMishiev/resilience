import { useAuth } from '../context/AuthContext'

export type UserRole = 'viewer' | 'commander' | 'operator'

export function useRole() {
  const { currentUser } = useAuth()
  const role = (currentUser?.role ?? 'viewer') as UserRole
  return {
    role,
    isCommander: role === 'commander',
    isOperator:  role === 'operator',
    isViewer:    role === 'viewer',
  }
}
