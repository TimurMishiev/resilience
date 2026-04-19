import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import EvidenceDrawer from '../components/EvidenceDrawer'
import type { Recommendation } from '../api/recommendations'
import type { SignalRuleMatch } from '../api/types'

vi.mock('../components/AlertChainDrawer', () => ({
  default: ({ match }: { match: SignalRuleMatch | null }) =>
    match ? <div>{`Chain drawer: ${match.id}`}</div> : null,
}))

const MATCH: SignalRuleMatch = {
  id:               'match-1',
  fired_at:         '2026-04-18T12:00:00Z',
  confidence:       0.91,
  workflow_status:  'acknowledged',
  acknowledged_at:  null,
  acknowledged_by:  null,
  notes:            null,
  metadata:         { distance_km: 12.4, signal_type: 'gps_jamming', signal_source: 'manual' },
  correlation_rule: { id: 'rule-1', name: 'Perimeter Watch' },
  site:             { id: 'site-1', name: 'Site Alpha' },
  task:             null,
  signal:           {
    id: 'sig-1', source: 'manual', signal_type: 'gps_jamming',
    lat: 10, lng: 20, occurred_at: '2026-04-18T11:58:00Z',
  },
}

const REC: Recommendation = {
  id:                   'rec-1',
  recommendation_type:  'create_task',
  tier:                 'rule',
  status:               'pending',
  confidence:           0.8,
  rationale:            'Escalate patrol response.',
  evidence: [
    { type: 'site',  id: 'site-1',  label: 'Site Alpha',  detail: 'within 5km' },
    { type: 'alert', id: 'match-1', label: 'Perimeter Watch', alert: MATCH },
    { type: 'asset', id: 'asset-missing', label: null },
  ],
  action_payload:       {},
  affected_entity_type: 'Site',
  affected_entity_id:   'site-1',
  expires_at:           '2026-04-19T10:00:00Z',
  reviewed_by:          null,
  reviewed_at:          null,
  review_reason:        null,
  executed_at:          null,
  created_at:           '2026-04-18T09:00:00Z',
}

describe('EvidenceDrawer', () => {
  it('renders resolved labels for evidence items and shows (unresolved) for missing entities', () => {
    render(<EvidenceDrawer rec={REC} onClose={() => {}} />)

    expect(screen.getByText('Site Alpha')).toBeInTheDocument()
    expect(screen.getByText('Perimeter Watch')).toBeInTheDocument()
    expect(screen.getByText('(unresolved)')).toBeInTheDocument()
  })

  it('opens the alert chain drawer when "Show chain" is clicked on an alert item', async () => {
    const user = userEvent.setup()
    render(<EvidenceDrawer rec={REC} onClose={() => {}} />)

    await user.click(screen.getByRole('button', { name: /show evidence chain for alert match-1/i }))

    expect(screen.getByText('Chain drawer: match-1')).toBeInTheDocument()
  })

  it('does not render the chain button on non-alert evidence items', () => {
    render(<EvidenceDrawer rec={REC} onClose={() => {}} />)

    expect(screen.queryByRole('button', { name: /show evidence chain for alert site-1/i })).not.toBeInTheDocument()
  })
})
