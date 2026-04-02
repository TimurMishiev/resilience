import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SwimlanePage from '../pages/SwimlanePage'

const mockReplay = vi.hoisted(() => ({
  isReplaying: false,
  asOf: null as string | null,
}))

const hookState = vi.hoisted(() => ({
  lastParams: null as null | Record<string, unknown>,
  lastEnabled: true,
  response: {
    data: [
      {
        site_id: 'site-1',
        site_name: 'Watchtower Bravo',
        area_of_operation_id: 'ao-1',
        area_of_operation_name: 'North Gulf',
        event_count: 3,
        visible_event_count: 3,
        last_event_at: '2026-03-29T11:45:00Z',
        events: [
          {
            id: 'match-1',
            event_kind: 'rule_fired',
            occurred_at: '2026-03-29T11:45:00Z',
            title: 'Rule fired',
            subtitle: 'Confidence 82%',
            actor: 'system',
            meta: {},
          },
        ],
      },
    ],
    meta: {
      days: 3,
      lane_limit: 8,
      lane_count: 1,
      total_events: 3,
      event_kinds: ['signal_detected', 'rule_fired', 'task_created', 'task_transitioned', 'site_event'],
      selected_site_ids: [],
    },
  },
}))

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({
    asOf: mockReplay.asOf,
    isReplaying: mockReplay.isReplaying,
  }),
}))

vi.mock('../hooks/useReadiness', () => ({
  useSwimlane: (params: Record<string, unknown>, options?: { enabled?: boolean }) => {
    hookState.lastParams = params
    hookState.lastEnabled = options?.enabled ?? true
    return {
      data: hookState.response,
      isPending: false,
      error: null,
      dataUpdatedAt: Date.parse('2026-03-29T12:00:00Z'),
    }
  },
}))

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SwimlanePage />
      </BrowserRouter>
    </QueryClientProvider>,
  )
}

describe('SwimlanePage', () => {
  beforeEach(() => {
    mockReplay.isReplaying = false
    mockReplay.asOf = null
    hookState.lastParams = null
    hookState.lastEnabled = true
  })

  it('renders live swimlane lanes and summary', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Swimlane' })).toBeInTheDocument()
    expect(screen.getByText('Watchtower Bravo')).toBeInTheDocument()
    expect(screen.getByText(/showing 1 sites \/ 3 events over 3 days/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Alert: Rule fired')).toBeInTheDocument()
  })

  it('renders a replay-anchored historical swimlane during replay', () => {
    mockReplay.isReplaying = true
    mockReplay.asOf = '2026-03-29T10:00:00Z'
    renderPage()

    expect(screen.getByText(/historical swimlane snapshot anchored to the selected replay time/i)).toBeInTheDocument()
    expect(screen.getByText(/Showing 1 sites \/ 3 events over 3 days · anchored/i)).toBeInTheDocument()
    expect(hookState.lastEnabled).toBe(true)
    expect(hookState.lastParams).toMatchObject({
      days: 3,
      lane_limit: 8,
      as_of: '2026-03-29T10:00:00Z',
    })
  })

  it('updates query params when lookback and kind filters change', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '7d' }))
    fireEvent.click(screen.getByRole('button', { name: 'Signal' }))

    expect(hookState.lastParams).toMatchObject({
      days: 7,
      kinds: ['rule_fired', 'task_created', 'task_transitioned', 'site_event'],
      lane_limit: 8,
    })
  })
})
