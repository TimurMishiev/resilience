import { useMutation } from '@tanstack/react-query'
import type { UseMutationOptions, UseMutationResult } from '@tanstack/react-query'
import type { MutationFunctionContext } from '@tanstack/query-core'
import { useReplay } from '../context/ReplayContext'

/**
 * Drop-in replacement for useMutation that rejects when the app is in replay mode.
 * Defence-in-depth: even if the UI fails to disable a mutation trigger,
 * the mutation itself will not fire.
 */
export function useReplayGuardedMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
): UseMutationResult<TData, TError, TVariables, TContext> {
  const { isReplaying } = useReplay()
  return useMutation({
    ...options,
    mutationFn: (variables: TVariables, context: MutationFunctionContext) => {
      if (isReplaying) {
        return Promise.reject(new Error('Mutations are blocked during replay'))
      }
      return options.mutationFn!(variables, context)
    },
  })
}
