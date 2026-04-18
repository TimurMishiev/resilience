import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Incident } from '../api/incidents'

const mockGetIncident = vi.hoisted(() => vi.fn())

vi.mock('../api/incidents', async () => {
  const actual = await vi.importActual<typeof import('../api/incidents')>('../api/incidents')
  return { ...actual, getIncident: mockGetIncident }
})

import IncidentCompareTab from '../components/incident-detail/IncidentCompareTab'

function baseIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'inc-1',
    title: 'Vessel intrusion',
    description: null,
    status: 'open',
    severity: 'high',
    confidence: 0.8,
    opened_at: '2026-04-10T10:00:00Z',
    acknowledged_at: null,
    closed_at: null,
    fusion_rationale: null,
    alert_count: 2,
    task_count: 0,
    assigned_to: null,
    assigned_at: null,
    site: { id: 's1', name: 'Site One' },
    area_of_operation: { id: 'ao1', name: 'AO', posture: 'observe' },
    prosecution_phase: null,
    prosecution_initiated_at: null,
    prosecuted_by: null,
    created_at: '2026-04-10T10:00:00Z',
    updated_at: '2026-04-10T10:00:00Z',
    alerts: [],
    tasks: [],
    ...overrides,
  }
}

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('IncidentCompareTab', () => {
  beforeEach(() => {
    mockGetIncident.mockReset()
  })

  it('renders hint state before Compare is pressed and does not fetch', () => {
    render(
      wrap(
        <IncidentCompareTab
          incidentId="inc-1"
          openedAt="2026-04-10T10:00:00Z"
          latestAt="2026-04-11T12:00:00Z"
        />,
      ),
    )

    expect(screen.getByText(/Pick two timestamps and press Compare/i)).toBeInTheDocument()
    expect(mockGetIncident).not.toHaveBeenCalled()
  })

  it('disables Compare when T1 >= T2 and surfaces the validation reason', async () => {
    const user = userEvent.setup()
    render(
      wrap(
        <IncidentCompareTab
          incidentId="inc-1"
          openedAt="2026-04-10T10:00:00Z"
          latestAt="2026-04-11T12:00:00Z"
        />,
      ),
    )

    // Force T1 == T2 by typing the same value into T1 as T2 currently holds.
    const t1 = screen.getByLabelText(/Compare T1 timestamp/i) as HTMLInputElement
    const t2 = screen.getByLabelText(/Compare T2 timestamp/i) as HTMLInputElement
    await user.clear(t1)
    await user.type(t1, t2.value)

    expect(screen.getByText(/T1 must be strictly before T2/i)).toBeInTheDocument()
    const compareBtn = screen.getByRole('button', { name: /Compare/i })
    expect(compareBtn).toBeDisabled()
    expect(mockGetIncident).not.toHaveBeenCalled()
  })

  it('fetches both snapshots and renders a diff when Compare is pressed', async () => {
    const user = userEvent.setup()

    mockGetIncident.mockImplementation((_id: string, params?: { as_of?: string }) => {
      const asOf = params?.as_of
      if (asOf?.startsWith('2026-04-10')) {
        return Promise.resolve(baseIncident({ status: 'open', severity: 'moderate' }))
      }
      return Promise.resolve(baseIncident({ status: 'contained', severity: 'high' }))
    })

    render(
      wrap(
        <IncidentCompareTab
          incidentId="inc-1"
          openedAt="2026-04-10T10:00:00Z"
          latestAt="2026-04-11T12:00:00Z"
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: /Compare/i }))

    await waitFor(() => expect(mockGetIncident).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Changed')).toBeInTheDocument()
    expect(screen.getByText('status')).toBeInTheDocument()
    expect(screen.getByText('severity')).toBeInTheDocument()
  })

  it('filters out ignored fields (updated_at, alerts, tasks) from the diff', async () => {
    const user = userEvent.setup()

    mockGetIncident.mockImplementation((_id: string, params?: { as_of?: string }) => {
      const asOf = params?.as_of
      if (asOf?.startsWith('2026-04-10')) {
        return Promise.resolve(
          baseIncident({
            updated_at: '2026-04-10T10:00:00Z',
            alerts: [],
            tasks: [],
          }),
        )
      }
      // Only volatile/computed fields differ — the user-visible diff should be empty.
      return Promise.resolve(
        baseIncident({
          updated_at: '2026-04-11T12:00:00Z',
          alerts: [{ id: 'a1' }] as unknown as Incident['alerts'],
          tasks: [{ id: 't1' }] as unknown as Incident['tasks'],
        }),
      )
    })

    render(
      wrap(
        <IncidentCompareTab
          incidentId="inc-1"
          openedAt="2026-04-10T10:00:00Z"
          latestAt="2026-04-11T12:00:00Z"
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: /Compare/i }))

    expect(await screen.findByText(/No incident changes/i)).toBeInTheDocument()
    expect(screen.queryByText('updated at')).not.toBeInTheDocument()
    expect(screen.queryByText('alerts')).not.toBeInTheDocument()
    expect(screen.queryByText('tasks')).not.toBeInTheDocument()
  })

  it('shows the error callout when one of the snapshot fetches fails', async () => {
    const user = userEvent.setup()

    mockGetIncident.mockImplementation((_id: string, params?: { as_of?: string }) => {
      const asOf = params?.as_of
      if (asOf?.startsWith('2026-04-10')) return Promise.resolve(baseIncident())
      return Promise.reject(new Error('snapshot unavailable'))
    })

    render(
      wrap(
        <IncidentCompareTab
          incidentId="inc-1"
          openedAt="2026-04-10T10:00:00Z"
          latestAt="2026-04-11T12:00:00Z"
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: /Compare/i }))

    expect(await screen.findByText(/Could not load both snapshots/i)).toBeInTheDocument()
    expect(screen.getByText(/snapshot unavailable/i)).toBeInTheDocument()
  })
})
