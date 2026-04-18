import { useAuth } from '../context/AuthContext'

export type UserRole = 'viewer' | 'commander' | 'operator' | 'admin'

export function useRole() {
  const { currentUser } = useAuth()
  const role = (currentUser?.role ?? 'viewer') as UserRole
  const isAdmin = role === 'admin'
  const isCommander = role === 'commander' || isAdmin
  const isOperator = role === 'operator'
  const isViewer = role === 'viewer'
  const canOperate = isOperator || isCommander

  return {
    role,
    isAdmin,
    isCommander,
    isOperator,
    isViewer,
    canAccessBriefing: isCommander,
    canAccessDebrief: isCommander,
    canAccessOntologyQuery: isCommander,
    canManageAreas: isCommander,
    canManageCorrelationRules: isCommander,
    canAccessPlanning: isCommander,
    canViewOperationalHealth: isCommander,
    canReviewRecommendations: isCommander,
    canGenerateRecommendations: isCommander,
    canManageUsers: isAdmin,
    canManageOrganizations: isAdmin,
    canManageSessionsForOthers: isAdmin,
    canOperateIncidents: canOperate,
    canOperateTasks: canOperate,
    canTriageAlerts: canOperate,
  }
}
