import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SignalRuleMatch } from '../api/types'
import AlertChainDrawer from '../components/AlertChainDrawer'

const REFERENCE_MS = Date.parse('2026-04-15T12:00:00Z')

function buildMatch(overrides: Partial<SignalRuleMatch> = {}): SignalRuleMatch {
  return {
    id: 'match-1',
    fired_at: '2026-04-15T11:59:00Z',
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
      occurred_at: '2026-04-15T11:59:50Z',
    },
    correlation_rule: { id: 'rule-1', name: 'Loitering near sensitive site' },
    site: { id: 'site-1', name: 'Site Alpha' },
    task: null,
    ...overrides,
  }
}

describe('AlertChainDrawer — stale-basis', () => {
  it('renders no freshness tag when the signal is fresh', () => {
    render(
      <AlertChainDrawer
        match={buildMatch()}
        onClose={() => {}}
        referenceTimeMs={REFERENCE_MS}
      />,
    )
    expect(screen.queryByTestId('alert-chain-signal-freshness')).toBeNull()
  })

  it('renders an aging tag when the signal is older than agingMs but within staleMs', () => {
    const match = buildMatch({
      signal: {
        id: 'signal-1',
        source: 'ais',
        signal_type: 'vessel_position',
        lat: 36.1,
        lng: -5.4,
        occurred_at: '2026-04-15T11:59:00Z',
      },
    })
    render(
      <AlertChainDrawer
        match={match}
        onClose={() => {}}
        referenceTimeMs={REFERENCE_MS}
      />,
    )
    const tag = screen.getByTestId('alert-chain-signal-freshness')
    expect(tag).toHaveTextContent('aging')
  })

  it('renders a stale tag when the signal is older than staleMs', () => {
    const match = buildMatch({
      signal: {
        id: 'signal-1',
        source: 'ais',
        signal_type: 'vessel_position',
        lat: 36.1,
        lng: -5.4,
        occurred_at: '2026-04-15T11:57:00Z',
      },
    })
    render(
      <AlertChainDrawer
        match={match}
        onClose={() => {}}
        referenceTimeMs={REFERENCE_MS}
      />,
    )
    const tag = screen.getByTestId('alert-chain-signal-freshness')
    expect(tag).toHaveTextContent('stale')
  })

  it('renders no freshness tag when the signal is missing', () => {
    render(
      <AlertChainDrawer
        match={buildMatch({ signal: null })}
        onClose={() => {}}
        referenceTimeMs={REFERENCE_MS}
      />,
    )
    expect(screen.queryByTestId('alert-chain-signal-freshness')).toBeNull()
  })

  it('renders nothing when match is null', () => {
    const { container } = render(<AlertChainDrawer match={null} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})
