import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Incident } from '../api/incidents'

const mockState = vi.hoisted(() => ({
  isReplaying: false,
  currentUser: { id: 'user-1', email: 'op@test.com', role: 'commander' },
  incident: null as Incident | null,
  isPending: false,
  error: null as Error | null,
  allowedTransitions: ['acknowledged', 'contained'] as string[],
}))

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({ isReplaying: mockState.isReplaying, asOf: null }),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ currentUser: mockState.currentUser }),
}))

vi.mock('../hooks/useIncidents', () => ({
  useIncident:                 () => ({ data: mockState.incident, isPending: mockState.isPending, error: mockState.error }),
  useIncidentAllowedTransitions: () => ({ data: { allowed: mockState.allowedTransitions } }),
  useTransitionIncident:       () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateIncident:           () => ({ mutate: vi.fn(), isPending: false }),
  useAssignIncident:           () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('../hooks/useAssets', () => ({
  useAssets: () => ({ data: { data: [] }, isPending: false }),
}))

vi.mock('../hooks/useTasks', () => ({
  useTasks:     () => ({ data: { data: [] }, isPending: false }),
  useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('../components/IntelChainPanel',              () => ({ default: () => null }))
vi.mock('../components/ProsecutionPanel',             () => ({ default: () => null }))
vi.mock('../components/AuditTimeline',                () => ({ default: () => null }))
vi.mock('../components/IncidentNotesPanel',           () => ({ default: () => null }))
vi.mock('../components/IncidentRecommendationsPanel', () => ({ default: () => null }))
vi.mock('../components/AssetPicker',                  () => ({ AssetPicker: () => null }))
vi.mock('../components/PostureBadge',                 () => ({ PostureBadge: () => null }))

const BASE_INCIDENT: Incident = {
  id:                         'inc-1',
  title:                      'Suspicious Vessel',
  description:                'Vessel went AIS dark near site.',
  status:                     'open',
  severity:                   'high',
  confidence:                 0.88,
  opened_at:                  '2026-03-20T10:00:00Z',
  acknowledged_at:            null,
  closed_at:                  null,
  fusion_rationale:           null,
  alert_count:                2,
  task_count:                 1,
  assigned_to:                null,
  assigned_at:                null,
  site:                       { id: 'site-1', name: 'Port Alpha' },
  area_of_operation:          { id: 'ao-1', name: 'Gulf Region', posture: 'observe' },
  prosecution_phase:          null,
  prosecution_initiated_at:   null,
  prosecuted_by:              null,
  created_at:                 '2026-03-20T10:00:00Z',
  updated_at:                 '2026-03-20T11:00:00Z',
  alerts:                     [],
  tasks:                      [],
}

function wrapper(id = 'inc-1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/incidents/${id}`]}>
        <Routes>
          <Route path="/incidents/:id" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

async function renderPage(id = 'inc-1') {
  const { default: IncidentDetailPage } = await import('../pages/IncidentDetailPage')
  return render(<IncidentDetailPage />, { wrapper: wrapper(id) })
}

beforeEach(() => {
  mockState.isReplaying = false
  mockState.incident = { ...BASE_INCIDENT }
  mockState.isPending = false
  mockState.error = null
  mockState.allowedTransitions = ['acknowledged', 'contained']
})

describe('IncidentDetailPage', () => {
  it('renders the incident title', async () => {
    await renderPage()
    await waitFor(() => {
      const matches = screen.getAllByText('Suspicious Vessel')
      expect(matches.length).toBeGreaterThan(0)
    })
  })

  it('shows loading skeleton while incident is pending', async () => {
    mockState.incident = null
    mockState.isPending = true
    await renderPage()
    // Spinner is rendered during load
    expect(document.querySelector('.bp6-spinner, [data-testid="spinner"]') ?? screen.queryByRole('progressbar')).toBeTruthy()
  })

  it('shows error callout when incident fails to load', async () => {
    mockState.incident = null
    mockState.isPending = false
    mockState.error = new Error('Network error')
    await renderPage()
    await waitFor(() => {
      expect(screen.getByText(/failed to load incident/i)).toBeTruthy()
    })
  })

  it('shows not found state when incident is null and not loading', async () => {
    mockState.incident = null
    mockState.isPending = false
    await renderPage()
    await waitFor(() => {
      expect(screen.getByText('Incident not found')).toBeTruthy()
    })
  })

  it('shows replay unavailable callout when replaying', async () => {
    mockState.isReplaying = true
    await renderPage()
    await waitFor(() => {
      expect(screen.getByText(/incident detail is unavailable during replay/i)).toBeTruthy()
    })
  })

  it('renders site name and severity', async () => {
    await renderPage()
    await waitFor(() => {
      expect(screen.getByText('Port Alpha')).toBeTruthy()
    })
  })

  it('renders breadcrumb back to incidents list', async () => {
    await renderPage()
    await waitFor(() => {
      expect(screen.getByText(/incidents/i)).toBeTruthy()
    })
  })
})
