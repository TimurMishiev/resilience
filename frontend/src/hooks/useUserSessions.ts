import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getUserSessions,
  revokeAllUserSessions,
  revokeUserSession,
  type UserSessionQueryParams,
  type RevokeAllSessionsParams,
} from '../api/auth'

export function useUserSessions(params?: UserSessionQueryParams, enabled = true) {
  return useQuery({
    queryKey: ['user-sessions', params],
    queryFn: () => getUserSessions(params),
    enabled,
    refetchInterval: 30_000,
  })
}

export function useRevokeUserSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, params }: { id: string; params?: UserSessionQueryParams }) =>
      revokeUserSession(id, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-sessions'] })
    },
  })
}

export function useRevokeAllUserSessions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params?: RevokeAllSessionsParams) => revokeAllUserSessions(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-sessions'] })
    },
  })
}
