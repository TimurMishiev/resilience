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
  lastQueryParams: undefined as unknown,
  lastQueryOptions: undefined as unknown,
}))

vi.mock('../hooks/useSignalRuleMatches', () => ({
  useSignalRuleMatches: (params?: unknown, options?: unknown) => {
    hookState.lastQueryParams = params
    hookState.lastQueryOptions = options
    return {
      data: hookState.data,
      isLoading: hookState.isLoading,
      error: hookState.error,
    }
  },
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

vi.mock('../components/AlertChainDrawer', () => ({
  default: ({ match, onClose }: { match: SignalRuleMatch | null; onClose: () => void }) =>
    match ? (
      <div data-testid="alert-chain-drawer">
        {`Chain drawer: ${match.id}`}
        <button data-testid="alert-chain-drawer-close" onClick={onClose}>Close</button>
      </div>
    ) : null,
}))

import { MapSignalAlertsSection } from '../components/MapSignalAlertsSection'

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

function renderSection(props: Partial<Parameters<typeof MapSignalAlertsSection>[0]> = {}) {
  return render(
    <MemoryRouter>
      <MapSignalAlertsSection
        signalId="signal-1"
        referenceTimeMs={REFERENCE_MS}
        canTriage
        onSelectSite={() => {}}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('MapSignalAlertsSection', () => {
  beforeEach(() => {
    hookState.data = undefined
    hookState.isLoading = false
    hookState.error = null
    hookState.transitionMutate = vi.fn()
    hookState.transitionIsPending = false
    hookState.replay = { isReplaying: false, asOf: null }
    hookState.lastQueryParams = undefined
    hookState.lastQueryOptions = undefined
  })

  it('renders the empty state when there are no alerts', () => {
    hookState.data = {
      data: [],
      meta: { page: 1, per_page: 5, total: 0, total_pages: 0 },
    }
    renderSection()
    expect(screen.getByText('No unacknowledged alerts triggered by this signal.')).toBeInTheDocument()
    expect(screen.queryByTestId('map-signal-alert-row')).toBeNull()
  })

  it('requests only unacknowledged alerts for the selected signal', () => {
    hookState.data = {
      data: [],
      meta: { page: 1, per_page: 5, total: 0, total_pages: 0 },
    }
    renderSection()
    expect(hookState.lastQueryParams).toEqual({
      signal_id: 'signal-1',
      workflow_status: 'unacknowledged',
      per_page: 5,
    })
    expect(hookState.lastQueryOptions).toEqual({ enabled: true })
  })

  it('renders rows with rule name, age, and confidence', () => {
    hookState.data = {
      data: [buildMatch()],
      meta: { page: 1, per_page: 5, total: 1, total_pages: 1 },
    }
    renderSection()
    expect(screen.getByText('Loitering near sensitive site')).toBeInTheDocument()
    expect(screen.getByText(/5m ago/)).toBeInTheDocument()
    expect(screen.getByText('82%')).toBeInTheDocument()
  })

  it('shows the Ack button for unacknowledged alerts when canTriage is true', () => {
    hookState.data = {
      data: [buildMatch()],
      meta: { page: 1, per_page: 5, total: 1, total_pages: 1 },
    }
    renderSection()
    expect(screen.getByTestId('map-signal-alert-ack')).toBeInTheDocument()
  })

  it('invokes the acknowledge mutation when the Ack button is clicked', () => {
    hookState.data = {
      data: [buildMatch()],
      meta: { page: 1, per_page: 5, total: 1, total_pages: 1 },
    }
    renderSection()
    fireEvent.click(screen.getByTestId('map-signal-alert-ack'))
    expect(hookState.transitionMutate).toHaveBeenCalledTimes(1)
    const [vars, options] = hookState.transitionMutate.mock.calls[0]
    expect(vars).toEqual({ id: 'match-1', body: { to_status: 'acknowledged' } })
    expect(options?.onSettled).toBeTypeOf('function')
    expect(options?.onError).toBeTypeOf('function')
  })

  it('opens related site context when a matched site is inspected', () => {
    const onSelectSite = vi.fn()
    hookState.data = {
      data: [buildMatch()],
      meta: { page: 1, per_page: 5, total: 1, total_pages: 1 },
    }
    renderSection({ onSelectSite })
    fireEvent.click(screen.getByTestId('map-signal-alert-open-site'))
    expect(onSelectSite).toHaveBeenCalledWith('site-1')
  })

  it('renders linked task context inline when the alert is tied to a task', () => {
    hookState.data = {
      data: [
        buildMatch({
          task: {
            id: 'task-1',
            title: 'Dispatch response team',
            workflow_status: 'in_progress',
            priority: 'high',
          },
        }),
      ],
      meta: { page: 1, per_page: 5, total: 1, total_pages: 1 },
    }
    renderSection()
    expect(screen.getByTestId('map-signal-alert-task')).toBeInTheDocument()
    expect(screen.getByText('Dispatch response team')).toBeInTheDocument()
    expect(screen.getByText('in progress')).toBeInTheDocument()
    expect(screen.getByText('high')).toBeInTheDocument()
  })

  it('surfaces an inline retry hint when the acknowledge mutation fails', () => {
    hookState.data = {
      data: [buildMatch()],
      meta: { page: 1, per_page: 5, total: 1, total_pages: 1 },
    }
    renderSection()
    fireEvent.click(screen.getByTestId('map-signal-alert-ack'))
    const [, options] = hookState.transitionMutate.mock.calls[0]
    act(() => {
      options?.onError?.(new Error('boom'))
      options?.onSettled?.()
    })
    expect(screen.getByTestId('map-signal-alert-failed')).toHaveTextContent('Ack failed — retry')
  })

  it('hides the Ack button when canTriage is false', () => {
    hookState.data = {
      data: [buildMatch()],
      meta: { page: 1, per_page: 5, total: 1, total_pages: 1 },
    }
    renderSection({ canTriage: false })
    expect(screen.queryByTestId('map-signal-alert-ack')).toBeNull()
  })

  it('still surfaces workflow_status tags defensively if a non-triage status appears', () => {
    hookState.data = {
      data: [buildMatch({ workflow_status: 'acknowledged' })],
      meta: { page: 1, per_page: 5, total: 1, total_pages: 1 },
    }
    renderSection()
    expect(screen.getByText('acknowledged')).toBeInTheDocument()
    expect(screen.queryByTestId('map-signal-alert-ack')).toBeNull()
  })

  it('renders nothing in replay mode', () => {
    hookState.replay = { isReplaying: true, asOf: '2026-04-10T09:00:00Z' }
    const { container } = renderSection()
    expect(container.firstChild).toBeNull()
  })

  it('shows loading state', () => {
    hookState.isLoading = true
    renderSection()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows error state', () => {
    hookState.error = new Error('Network error')
    renderSection()
    expect(screen.getByText('Failed to load alerts.')).toBeInTheDocument()
  })

  it('opens the alert chain drawer when the Chain button is clicked', () => {
    hookState.data = {
      data: [buildMatch()],
      meta: { page: 1, per_page: 5, total: 1, total_pages: 1 },
    }
    renderSection()
    expect(screen.queryByTestId('alert-chain-drawer')).toBeNull()

    const chainButton = screen.getByTestId('map-signal-alert-chain')
    expect(chainButton).toHaveAttribute('aria-label', 'Show evidence chain for alert match-1')

    fireEvent.click(chainButton)
    expect(screen.getByTestId('alert-chain-drawer')).toHaveTextContent('Chain drawer: match-1')
  })

  it('closes the alert chain drawer when onClose is invoked', () => {
    hookState.data = {
      data: [buildMatch()],
      meta: { page: 1, per_page: 5, total: 1, total_pages: 1 },
    }
    renderSection()
    fireEvent.click(screen.getByTestId('map-signal-alert-chain'))
    expect(screen.getByTestId('alert-chain-drawer')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('alert-chain-drawer-close'))
    expect(screen.queryByTestId('alert-chain-drawer')).toBeNull()
  })
})
