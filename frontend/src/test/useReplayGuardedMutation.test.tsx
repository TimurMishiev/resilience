import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useReplayGuardedMutation } from '../hooks/useReplayGuardedMutation'
import { ReplayProvider, useReplay } from '../context/ReplayContext'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ReplayProvider>{children}</ReplayProvider>
      </QueryClientProvider>
    )
  }
}

function useTestHarness(mutationFn: (v: string) => Promise<string>) {
  const replay = useReplay()
  const mutation = useReplayGuardedMutation({ mutationFn })
  return { replay, mutation }
}

describe('useReplayGuardedMutation', () => {
  it('allows mutations in live mode', async () => {
    const mutationFn = vi.fn().mockResolvedValue('ok')
    const { result } = renderHook(() => useTestHarness(mutationFn), {
      wrapper: createWrapper(),
    })

    act(() => result.current.mutation.mutate('test'))

    await waitFor(() => {
      expect(result.current.mutation.isSuccess).toBe(true)
    })
    expect(mutationFn).toHaveBeenCalledWith('test', expect.objectContaining({ client: expect.anything() }))
    expect(result.current.mutation.data).toBe('ok')
  })

  it('rejects mutations during replay', async () => {
    const mutationFn = vi.fn().mockResolvedValue('should not reach')
    const { result } = renderHook(() => useTestHarness(mutationFn), {
      wrapper: createWrapper(),
    })

    // Enter replay mode
    act(() => result.current.replay.setAsOf('2026-03-01T12:00:00.000Z'))
    expect(result.current.replay.isReplaying).toBe(true)

    // Attempt mutation — should be rejected
    act(() => result.current.mutation.mutate('blocked'))

    await waitFor(() => {
      expect(result.current.mutation.isError).toBe(true)
    })
    expect(mutationFn).not.toHaveBeenCalled()
    expect(result.current.mutation.error).toBeInstanceOf(Error)
    expect((result.current.mutation.error as Error).message).toBe(
      'Mutations are blocked during replay',
    )
  })

  it('allows mutations again after exiting replay', async () => {
    const mutationFn = vi.fn().mockResolvedValue('after-replay')
    const { result } = renderHook(() => useTestHarness(mutationFn), {
      wrapper: createWrapper(),
    })

    // Enter then exit replay
    act(() => result.current.replay.setAsOf('2026-03-01T12:00:00.000Z'))
    act(() => result.current.replay.setAsOf(null))
    expect(result.current.replay.isReplaying).toBe(false)

    act(() => result.current.mutation.mutate('allowed'))

    await waitFor(() => {
      expect(result.current.mutation.isSuccess).toBe(true)
    })
    expect(mutationFn).toHaveBeenCalledWith('allowed', expect.objectContaining({ client: expect.anything() }))
  })
})
