import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDryRunRule = vi.hoisted(() => vi.fn())

vi.mock('../api/correlation_rules', () => ({
  dryRunRule: (...args: unknown[]) => mockDryRunRule(...args),
}))

import { DryRunDrawer } from '../components/correlationRules/DryRunDrawer'
import type { CorrelationRule } from '../api/types'

const RULE: CorrelationRule = {
  id: 'rule-1',
  name: 'Seismic Near Site',
  description: 'Fires on nearby earthquakes',
  is_active: true,
  cooldown_minutes: 10,
  conditions: { signal_type: 'seismic_event', proximity_km: 50 },
  actions: { create_task: { title: 'Quake alert' } },
  created_by: 'user-1',
  area_of_operation_id: null,
  mitre_tags: [],
  last_fired_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function renderDrawer(rule: CorrelationRule | null = RULE) {
  const onClose = vi.fn()
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <DryRunDrawer rule={rule} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { onClose }
}

describe('DryRunDrawer', () => {
  beforeEach(() => {
    mockDryRunRule.mockReset()
  })

  it('renders title and run button when rule is provided', () => {
    renderDrawer()

    expect(screen.getByText(/Dry Run — Seismic Near Site/)).toBeInTheDocument()
    expect(screen.getByText('Run')).toBeInTheDocument()
  })

  it('does not render when rule is null', () => {
    renderDrawer(null)

    expect(screen.queryByText('Run')).not.toBeInTheDocument()
  })

  it('calls dryRunRule with rule id and hours on submit', async () => {
    mockDryRunRule.mockResolvedValue({
      rule_id: 'rule-1',
      rule_name: 'Seismic Near Site',
      window_hours: 24,
      total_matches: 0,
      matches: [],
    })
    const user = userEvent.setup()
    renderDrawer()

    await user.click(screen.getByText('Run'))

    expect(mockDryRunRule).toHaveBeenCalledWith('rule-1', 24)
  })

  it('displays match count after successful dry run', async () => {
    mockDryRunRule.mockResolvedValue({
      rule_id: 'rule-1',
      rule_name: 'Seismic Near Site',
      window_hours: 24,
      total_matches: 3,
      matches: [
        {
          signal_id: 's-1',
          signal_type: 'seismic_event',
          source: 'usgs_seismic',
          lat: 51.5,
          lng: -0.1,
          magnitude: 4.2,
          occurred_at: '2026-03-24T00:00:00Z',
          site_id: 'site-1',
          site_name: 'Alpha Base',
          distance_km: 12.5,
          would_fire: ['create_task'],
        },
      ],
    })
    const user = userEvent.setup()
    renderDrawer()

    await user.click(screen.getByText('Run'))

    expect(await screen.findByText(/3 matches/)).toBeInTheDocument()
    expect(screen.getByText('Alpha Base')).toBeInTheDocument()
    expect(screen.getByText('12.5 km')).toBeInTheDocument()
  })

  it('displays error callout on failure', async () => {
    mockDryRunRule.mockRejectedValue(new Error('Server error'))
    const user = userEvent.setup()
    renderDrawer()

    await user.click(screen.getByText('Run'))

    expect(await screen.findByText('Server error')).toBeInTheDocument()
  })

  it('calls onClose when drawer is closed', async () => {
    const { onClose } = renderDrawer()
    const user = userEvent.setup()

    await user.click(screen.getByLabelText('Close'))

    expect(onClose).toHaveBeenCalled()
  })
})
