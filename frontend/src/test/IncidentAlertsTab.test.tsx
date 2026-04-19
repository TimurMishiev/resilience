import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import IncidentAlertsTab from '../components/incident-detail/IncidentAlertsTab'
import type { IncidentAlert } from '../api/incidents'

vi.mock('../components/AlertChainDrawer', () => ({
  default: ({ match }: { match: IncidentAlert | null }) =>
    match ? <div>{`Evidence drawer: ${match.id}`}</div> : null,
}))

const ALERT: IncidentAlert = {
  id: 'match-1',
  fired_at: '2026-04-18T12:00:00Z',
  confidence: 0.91,
  workflow_status: 'acknowledged',
  acknowledged_at: '2026-04-18T12:05:00Z',
  acknowledged_by: { id: 'user-1', email: 'commander@resilience.mil' },
  notes: 'Reviewed against perimeter camera',
  metadata: {
    distance_km: 12.4,
    signal_type: 'gps_jamming',
    signal_source: 'manual',
    actions_taken: ['create_task'],
  },
  geofence_breach: false,
  correlation_rule: { id: 'rule-1', name: 'Perimeter Watch' },
  site: { id: 'site-1', name: 'Site Alpha' },
  task: {
    id: 'task-1',
    title: 'Inspect perimeter',
    workflow_status: 'new',
    priority: 'high',
  },
  signal: {
    id: 'sig-1',
    source: 'manual',
    signal_type: 'gps_jamming',
    lat: 10,
    lng: 20,
    occurred_at: '2026-04-18T11:58:00Z',
  },
}

describe('IncidentAlertsTab', () => {
  it('renders the empty state when no alerts are linked', () => {
    render(<IncidentAlertsTab alerts={[]} />)

    expect(screen.getByRole('heading', { name: 'No alerts' })).toBeInTheDocument()
    expect(screen.getByText(/no alerts are linked to this incident yet/i)).toBeInTheDocument()
  })

  it('opens the evidence chain drawer for a linked alert', async () => {
    const user = userEvent.setup()

    render(<IncidentAlertsTab alerts={[ALERT]} />)

    await user.click(screen.getByRole('button', { name: /show evidence for alert match-1/i }))

    expect(screen.getByText('Evidence drawer: match-1')).toBeInTheDocument()
  })
})
