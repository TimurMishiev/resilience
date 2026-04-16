import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SignalRuleMatch } from '../api/types'

const hookState = vi.hoisted(() => ({
  data: undefined as
    | { data: SignalRuleMatch[]; meta: { page: number; per_page: number; total: number; total_pages: number } }
    | undefined,
  isLoading: false,
  error: null as Error | null,
  transitionMutate: vi.fn(),
  transitionIsPending: false,
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
        isReplaying={false}
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
    expect(hookState.transitionMutate).toHaveBeenCalledWith({
      id: 'match-1',
      body: { to_status: 'acknowledged' },
    })
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

  it('renders nothing in replay mode', () => {
    const { container } = renderSection({ isReplaying: true })
    expect(container.firstChild).toBeNull()
  })
})
