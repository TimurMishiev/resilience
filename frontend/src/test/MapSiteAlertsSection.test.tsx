import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SignalRuleMatch } from '../api/types'

type MutateOptions = {
  onSettled?: () => void
  onError?: (error: Error) => void
}

const hookState = vi.hoisted(() => ({
  data: undefined as
    | { data: SignalRuleMatch[]; meta: { page: number; per_page: number; total: number; total_pages: number } }
    | undefined,
  isLoading: false,
  error: null as Error | null,
  transitionMutate: vi.fn<(vars: { id: string; body: unknown }, options?: MutateOptions) => void>(),
  transitionIsPending: false,
  replay: { isReplaying: false, asOf: null as string | null },
}))

vi.mock('../hooks/useSignalRuleMatches', () => ({
  useSignalRuleMatches: () => ({
    data: hookState.data,
    isLoading: hookState.isLoading,
    error: hookState.error,
  }),
  useTransitionAlert: () => ({
    mutate: hookState.transitionMutate,
    isPending: hookState.transitionIsPending,
  }),
}))

vi.mock('../hooks/useReplayParams', () => ({
  useReplayParams: () => ({
    isReplaying: hookState.replay.isReplaying,
    asOf: hookState.replay.asOf,
    asOfParam: hookState.replay.asOf ? { as_of: hookState.replay.asOf } : {},
    signalQueryParams: {},
  }),
}))

import { MapSiteAlertsSection } from '../components/MapSiteAlertsSection'

const REFERENCE_MS = Date.parse('2026-04-15T12:00:00Z')

function buildMatch(overrides: Partial<SignalRuleMatch> = {}): SignalRuleMatch {
  return {
    id: 'match-1',
    fired_at: '2026-04-15T11:55:00Z',
    confidence: 0.82,
    workflow_status: 'unacknowledged',
    acknowledged_at: null,
    acknowledged_by: null,
    notes: null,
    metadata: {},
    signal: {
      id: 'signal-1',
      source: 'ais',
      signal_type: 'vessel_position',
      lat: 36.1,
      lng: -5.4,
      occurred_at: '2026-04-15T11:54:00Z',
    },
    correlation_rule: { id: 'rule-1', name: 'Loitering near sensitive site' },
    site: { id: 'site-1', name: 'Site Alpha' },
    task: null,
    ...overrides,
  }
}

function renderSection(props: Partial<Parameters<typeof MapSiteAlertsSection>[0]> = {}) {
  return render(
    <MemoryRouter>
      <MapSiteAlertsSection
        siteId="site-1"
        referenceTimeMs={REFERENCE_MS}
        canTriage
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('MapSiteAlertsSection', () => {
  beforeEach(() => {
    hookState.data = undefined
    hookState.isLoading = false
    hookState.error = null
    hookState.transitionMutate = vi.fn()
    hookState.transitionIsPending = false
    hookState.replay = { isReplaying: false, asOf: null }
  })

  it('renders the empty state when there are no unacknowledged alerts', () => {
    hookState.data = {
      data: [],
      meta: { page: 1, per_page: 5, total: 0, total_pages: 0 },
    }
    renderSection()
    expect(screen.getByText('No unacknowledged alerts.')).toBeInTheDocument()
    expect(screen.queryByTestId('map-site-alert-row')).toBeNull()
  })

  it('renders rows with rule name, age off shared clock, and confidence', () => {
    hookState.data = {
      data: [buildMatch()],
      meta: { page: 1, per_page: 5, total: 1, total_pages: 1 },
    }
    renderSection()
    expect(screen.getByText('Loitering near sensitive site')).toBeInTheDocument()
    expect(screen.getByText(/5m ago/)).toBeInTheDocument()
    expect(screen.getByText('82%')).toBeInTheDocument()
    expect(screen.queryByText(/View all/)).toBeNull()
  })

  it('invokes the acknowledge mutation when the Ack button is clicked', () => {
    hookState.data = {
      data: [buildMatch()],
      meta: { page: 1, per_page: 5, total: 1, total_pages: 1 },
    }
    renderSection()
    fireEvent.click(screen.getByTestId('map-site-alert-ack'))
    expect(hookState.transitionMutate).toHaveBeenCalledTimes(1)
    const [vars, options] = hookState.transitionMutate.mock.calls[0]
    expect(vars).toEqual({ id: 'match-1', body: { to_status: 'acknowledged' } })
    expect(options?.onSettled).toBeTypeOf('function')
    expect(options?.onError).toBeTypeOf('function')
  })

  it('surfaces an inline retry hint when the acknowledge mutation fails', () => {
    hookState.data = {
      data: [buildMatch()],
      meta: { page: 1, per_page: 5, total: 1, total_pages: 1 },
    }
    renderSection()
    fireEvent.click(screen.getByTestId('map-site-alert-ack'))
    const [, options] = hookState.transitionMutate.mock.calls[0]
    act(() => {
      options?.onError?.(new Error('boom'))
      options?.onSettled?.()
    })
    expect(screen.getByTestId('map-site-alert-failed')).toHaveTextContent('Ack failed — retry')
  })

  it('hides the Ack button when the role cannot triage', () => {
    hookState.data = {
      data: [buildMatch()],
      meta: { page: 1, per_page: 5, total: 1, total_pages: 1 },
    }
    renderSection({ canTriage: false })
    expect(screen.queryByTestId('map-site-alert-ack')).toBeNull()
  })

  it('shows a view-all link when the total exceeds the displayed rows', () => {
    hookState.data = {
      data: [buildMatch(), buildMatch({ id: 'match-2' })],
      meta: { page: 1, per_page: 5, total: 12, total_pages: 3 },
    }
    renderSection()
    const link = screen.getByRole('link', { name: /View all 12/ })
    expect(link).toHaveAttribute(
      'href',
      '/alerts?site_id=site-1&workflow_status=unacknowledged',
    )
  })

  it('appends as_of to the view-all link when the replay clock is active', () => {
    hookState.replay = { isReplaying: false, asOf: '2026-04-10T09:00:00Z' }
    hookState.data = {
      data: [buildMatch(), buildMatch({ id: 'match-2' })],
      meta: { page: 1, per_page: 5, total: 12, total_pages: 3 },
    }
    renderSection()
    const link = screen.getByRole('link', { name: /View all 12/ })
    expect(link).toHaveAttribute(
      'href',
      '/alerts?site_id=site-1&workflow_status=unacknowledged&as_of=2026-04-10T09%3A00%3A00Z',
    )
  })

  it('renders nothing in replay mode', () => {
    hookState.replay = { isReplaying: true, asOf: '2026-04-10T09:00:00Z' }
    const { container } = renderSection()
    expect(container.firstChild).toBeNull()
  })
})
