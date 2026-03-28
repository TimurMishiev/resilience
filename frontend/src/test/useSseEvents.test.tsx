import { renderHook } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSseEvents } from '../hooks/useSseEvents'

type SseCallback = ((event: { event: string; data: unknown }) => void) | undefined

const mocks = vi.hoisted(() => ({
  showMock: vi.fn(),
}))
let onEventCallback: SseCallback

vi.mock('../hooks/useEventSource', () => ({
  useEventSource: ({ onEvent }: { onEvent?: SseCallback }) => {
    onEventCallback = onEvent
    return { status: 'connected' as const }
  },
}))

vi.mock('../lib/toaster', () => ({
  AppToaster: Promise.resolve({ show: mocks.showMock }),
}))

describe('useSseEvents', () => {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined)
  const queryClient = { invalidateQueries } as unknown as QueryClient

  beforeEach(() => {
    invalidateQueries.mockClear()
    mocks.showMock.mockClear()
    onEventCallback = undefined
  })

  it.each([
    ['task_created', { title: 'Create task', priority: 'high', site_name: 'Watchtower Bravo' }],
    ['task_updated', { id: 'task-1', title: 'Update task' }],
    ['task_transitioned', { title: 'Transition task', workflow_status: 'resolved', site_name: 'Watchtower Bravo' }],
    ['posture_changed', { area_of_operation_id: 'ao-1', name: 'North Gulf', posture: 'defensive' }],
    ['planning_doctrine_updated', { kind: 'pace_plan', area_of_operation_id: 'ao-1' }],
    ['chokepoint_updated', { kind: 'updated', area_of_operation_id: 'ao-1' }],
  ])('invalidates planning for %s events', (eventName, data) => {
    renderHook(() => useSseEvents({ enabled: true, queryClient }))

    onEventCallback?.({ event: eventName, data })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['planning'] })
  })
})
