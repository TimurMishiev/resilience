import { useAuth } from '../context/AuthContext'

export type UserRole = 'commander' | 'operator'

export function useRole() {
  const { currentUser } = useAuth()
  const role = (currentUser?.role ?? 'operator') as UserRole
  return {
    role,
    isCommander: role === 'commander',
    isOperator:  role === 'operator',
  }
}
