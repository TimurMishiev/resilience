import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const mockRole = vi.hoisted(() => ({ role: 'commander' as 'commander' | 'operator' | 'viewer' }))

vi.mock('../hooks/useSite', () => ({
  useSite: () => ({
    data: {
      id: 'site-1',
      name: 'Watchtower Bravo',
      latitude: 10,
      longitude: 20,
      status: 'active',
      area_of_operation_id: 'ao-1',
      geofence_radius_km: 10,
      created_at: '2026-03-27T12:00:00Z',
      updated_at: '2026-03-27T12:00:00Z',
      flagged_at: null,
      flag_reason: null,
    },
    isPending: false,
    error: null,
  }),
  useUnflagSite: () => ({ mutate: vi.fn(), isPending: false }),
  useToggleSiteStatus: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSiteGeofence: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('../hooks/useTasks', () => ({
  useTasks: () => ({
    data: {
      data: [
        {
          id: 'task-1',
          site_id: 'site-1',
          asset_id: null,
          title: 'Patrol perimeter',
          description: null,
          priority: 'high',
          workflow_status: 'new',
          blocked_reason: null,
          resolved_at: null,
          created_at: '2026-03-27T12:00:00Z',
          updated_at: '2026-03-27T12:00:00Z',
          site_name: 'Watchtower Bravo',
          ao_id: 'ao-1',
          ao_posture: 'defensive',
        },
        {
          id: 'task-2',
          site_id: 'site-1',
          asset_id: null,
          title: 'Inspect quay',
          description: null,
          priority: 'normal',
          workflow_status: 'triaged',
          blocked_reason: null,
          resolved_at: null,
          created_at: '2026-03-27T12:10:00Z',
          updated_at: '2026-03-27T12:10:00Z',
          site_name: 'Watchtower Bravo',
          ao_id: 'ao-1',
          ao_posture: 'defensive',
        },
      ],
      meta: { total: 2, page: 1, per_page: 50, total_pages: 1 },
    },
    isPending: false,
    error: null,
  }),
  useCreateTask: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('../hooks/useSignals', () => ({
  useSignals: () => ({ data: { data: [] }, isPending: false, error: null }),
}))

vi.mock('../hooks/useSignalRuleMatches', () => ({
  useSignalRuleMatches: () => ({ data: { data: [], meta: { total: 0 } }, isPending: false, error: null }),
  useTransitionAlert: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkTransitionAlerts: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('../hooks/useAssets', () => ({
  useAssets: () => ({ data: { data: [] }, isPending: false, error: null }),
}))

vi.mock('../hooks/useReadiness', () => ({
  useReadiness: () => ({ data: [] }),
}))

vi.mock('../hooks/useSites', () => ({
  useSites: () => ({ data: { data: [] }, isPending: false, error: null }),
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => ({
    role: mockRole.role,
    isCommander: mockRole.role === 'commander',
    isOperator: mockRole.role === 'operator',
    isViewer: mockRole.role === 'viewer',
  }),
}))

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({ asOf: null, isReplaying: false }),
}))

vi.mock('../components/EntityCard', () => ({
  default: ({ entityType, entityId }: { entityType: string; entityId: string }) => (
    <div>{`${entityType}:${entityId}`}</div>
  ),
}))

vi.mock('../components/AuditTimeline', () => ({
  default: () => null,
}))

vi.mock('../components/SiteTimeline', () => ({
  default: () => null,
}))

vi.mock('../components/AlertChainDrawer', () => ({
  default: () => null,
}))

vi.mock('../components/RiskScoreChart', () => ({
  default: () => null,
}))

import SiteDetailPage from '../pages/SiteDetailPage'

function SiteDetailHarness() {
  const navigate = useNavigate()

  return (
    <>
      <button type="button" onClick={() => navigate('/sites/site-1?task=task-2')}>
        Jump to task 2
      </button>
      <button type="button" onClick={() => navigate('/sites/site-1')}>
        Clear task
      </button>
      <SiteDetailPage />
    </>
  )
}

describe('SiteDetailPage task deep links', () => {
  it('updates the selected task drawer when the same site route changes task query params', async () => {
    mockRole.role = 'commander'
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/sites/site-1?task=task-1']}>
        <Routes>
          <Route path="/sites/:id" element={<SiteDetailHarness />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('task:task-1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Jump to task 2' }))
    expect(await screen.findByText('task:task-2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear task' }))
    await waitFor(() => {
      expect(screen.queryByText('task:task-2')).not.toBeInTheDocument()
    })
  })
})
