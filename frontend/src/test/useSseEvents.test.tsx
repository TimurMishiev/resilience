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

  it('invalidates sites and readiness for site_risk_updated', () => {
    renderHook(() => useSseEvents({ enabled: true, queryClient }))
    onEventCallback?.({ event: 'site_risk_updated', data: { site_id: 'site-1' } })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sites'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['readiness'] })
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['risk_scores'] })
  })

  it.each([
    ['task_created', { title: 'Create task', priority: 'high', site_name: 'Watchtower Bravo' }],
    ['task_updated', { id: 'task-1', title: 'Update task' }],
    ['task_transitioned', { title: 'Transition task', workflow_status: 'resolved', site_name: 'Watchtower Bravo' }],
    ['posture_changed', { area_of_operation_id: 'ao-1', name: 'North Gulf', posture: 'defensive' }],
    ['planning_doctrine_updated', { kind: 'pace_plan', area_of_operation_id: 'ao-1' }],
    ['chokepoint_updated', { kind: 'updated', chokepoint_name: 'Hormuz East', area_of_operation_name: 'Northern Gulf' }],
  ])('invalidates planning for %s events', (eventName, data) => {
    renderHook(() => useSseEvents({ enabled: true, queryClient }))

    onEventCallback?.({ event: eventName, data })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['planning'] })
  })

  it.each([
    ['rule_fired', { rule_name: 'Perimeter Watch', site_name: 'Watchtower Bravo', task_title: null, priority: null, signal_type: 'wildfire', distance_km: 12.5, confidence: 0.84, actions_taken: [] }],
    ['alert_transitioned', { workflow_status: 'closed', acknowledged_by: 'commander@demo.com', rule_name: 'Perimeter Watch', site_name: 'Watchtower Bravo', notes: null }],
    ['task_created', { title: 'Create task', priority: 'high', site_name: 'Watchtower Bravo' }],
    ['task_transitioned', { title: 'Transition task', workflow_status: 'resolved', site_name: 'Watchtower Bravo' }],
  ])('invalidates risk_scores for %s events', (eventName, data) => {
    renderHook(() => useSseEvents({ enabled: true, queryClient }))

    onEventCallback?.({ event: eventName, data })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['risk_scores'] })
  })

  it.each([
    ['task_updated', { id: 'task-1', title: 'Update task' }],
    ['site_risk_updated', { site_id: 'site-1' }],
    ['posture_changed', { area_of_operation_id: 'ao-1', name: 'North Gulf', posture: 'defensive' }],
    ['planning_doctrine_updated', { kind: 'pace_plan', area_of_operation_id: 'ao-1' }],
    ['chokepoint_updated', { kind: 'updated', chokepoint_name: 'Hormuz East', area_of_operation_name: 'Northern Gulf' }],
  ])('does not invalidate risk_scores for %s events', (eventName, data) => {
    renderHook(() => useSseEvents({ enabled: true, queryClient }))

    onEventCallback?.({ event: eventName, data })

    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['risk_scores'] })
  })

  it('shows a toast for chokepoint_updated events', async () => {
    renderHook(() => useSseEvents({ enabled: true, queryClient }))

    onEventCallback?.({
      event: 'chokepoint_updated',
      data: { kind: 'created', chokepoint_name: 'Bab el-Mandeb West', area_of_operation_name: 'Southern Arc' },
    })

    await vi.waitFor(() => expect(mocks.showMock).toHaveBeenCalledOnce())
    expect(mocks.showMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Bab el-Mandeb West'),
        intent:  'primary',
      })
    )
  })

  it('shows a toast for planning_doctrine_updated events', async () => {
    renderHook(() => useSseEvents({ enabled: true, queryClient }))

    onEventCallback?.({
      event: 'planning_doctrine_updated',
      data: { kind: 'commander_intent', area_of_operation_id: 'ao-1' },
    })

    await vi.waitFor(() => expect(mocks.showMock).toHaveBeenCalledOnce())
    expect(mocks.showMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Commander Intent updated'),
        intent:  'primary',
      })
    )
  })
})
