import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Site, SiteReadiness } from '../api/types'

const mockGetSite = vi.hoisted(() => vi.fn())
const mockGetReadiness = vi.hoisted(() => vi.fn())

vi.mock('../api/sites', async () => {
  const actual = await vi.importActual<typeof import('../api/sites')>('../api/sites')
  return { ...actual, getSite: mockGetSite }
})

vi.mock('../api/readiness', async () => {
  const actual = await vi.importActual<typeof import('../api/readiness')>('../api/readiness')
  return { ...actual, getReadiness: mockGetReadiness }
})

import SiteCompareTab from '../components/site-detail/SiteCompareTab'

function baseSite(overrides: Partial<Site> = {}): Site {
  return {
    id: 'site-1',
    name: 'Forward Outpost',
    latitude: 40.1,
    longitude: -74.2,
    status: 'active',
    area_of_operation_id: 'ao-1',
    flagged_at: null,
    flag_reason: null,
    geofence_radius_km: 5,
    created_at: '2026-04-01T08:00:00Z',
    updated_at: '2026-04-15T08:00:00Z',
    ...overrides,
  }
}

function baseReadiness(overrides: Partial<SiteReadiness> = {}): SiteReadiness {
  return {
    site_id: 'site-1',
    site_name: 'Forward Outpost',
    score: 0.82,
    counts: { total: 10, resolved: 6, blocked: 1, in_progress: 2, new: 1, triaged: 0 },
    computed_at: '2026-04-15T08:00:00Z',
    as_of: null,
    ...overrides,
  }
}

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('SiteCompareTab', () => {
  beforeEach(() => {
    mockGetSite.mockReset()
    mockGetReadiness.mockReset()
  })

  it('renders hint state before Compare is pressed and does not fetch', () => {
    render(
      wrap(
        <SiteCompareTab
          siteId="site-1"
          openedAt="2026-04-01T08:00:00Z"
          latestAt="2026-04-15T08:00:00Z"
        />,
      ),
    )

    expect(screen.getByText(/Pick two timestamps and press Compare/i)).toBeInTheDocument()
    expect(mockGetSite).not.toHaveBeenCalled()
    expect(mockGetReadiness).not.toHaveBeenCalled()
  })

  it('disables Compare when T1 >= T2 and surfaces the validation reason', async () => {
    const user = userEvent.setup()
    render(
      wrap(
        <SiteCompareTab
          siteId="site-1"
          openedAt="2026-04-01T08:00:00Z"
          latestAt="2026-04-15T08:00:00Z"
        />,
      ),
    )

    const t1 = screen.getByLabelText(/Compare T1 timestamp/i) as HTMLInputElement
    const t2 = screen.getByLabelText(/Compare T2 timestamp/i) as HTMLInputElement
    await user.clear(t1)
    await user.type(t1, t2.value)

    expect(screen.getByText(/T1 must be strictly before T2/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Compare/i })).toBeDisabled()
    expect(mockGetSite).not.toHaveBeenCalled()
    expect(mockGetReadiness).not.toHaveBeenCalled()
  })

  it('fetches both site + readiness snapshots and renders the combined diff', async () => {
    const user = userEvent.setup()

    mockGetSite.mockImplementation((_id: string, params?: { as_of?: string }) => {
      if (params?.as_of?.startsWith('2026-04-01')) {
        return Promise.resolve(
          baseSite({ status: 'inactive', flagged_at: null, geofence_radius_km: 5 }),
        )
      }
      return Promise.resolve(
        baseSite({
          status: 'active',
          flagged_at: '2026-04-10T12:00:00Z',
          flag_reason: 'suspicious activity',
          geofence_radius_km: 10,
        }),
      )
    })

    mockGetReadiness.mockImplementation((params?: { as_of?: string }) => {
      if (params?.as_of?.startsWith('2026-04-01')) {
        return Promise.resolve([
          baseReadiness({ score: 0.5, counts: { total: 8, resolved: 3, blocked: 2, in_progress: 2, new: 1, triaged: 0 } }),
        ])
      }
      return Promise.resolve([
        baseReadiness({ score: 0.85, counts: { total: 10, resolved: 8, blocked: 0, in_progress: 1, new: 1, triaged: 0 } }),
      ])
    })

    render(
      wrap(
        <SiteCompareTab
          siteId="site-1"
          openedAt="2026-04-01T08:00:00Z"
          latestAt="2026-04-15T08:00:00Z"
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: /Compare/i }))

    await waitFor(() => {
      expect(mockGetSite).toHaveBeenCalledTimes(2)
      expect(mockGetReadiness).toHaveBeenCalledTimes(2)
    })

    expect(await screen.findByText('Changed')).toBeInTheDocument()
    // site scalar deltas
    expect(screen.getByText('status')).toBeInTheDocument()
    expect(screen.getByText('geofence radius km')).toBeInTheDocument()
    // readiness scalar deltas
    expect(screen.getByText('readiness score')).toBeInTheDocument()
    expect(screen.getByText('tasks resolved')).toBeInTheDocument()
    expect(screen.getByText('tasks blocked')).toBeInTheDocument()
    // flag_reason exists in both snapshots with different values (null → string),
    // so it's a Changed row, not Added.
    expect(screen.getByText('flag reason')).toBeInTheDocument()
    expect(screen.getByText('suspicious activity')).toBeInTheDocument()
    expect(screen.queryByText('Added')).not.toBeInTheDocument()
    expect(screen.queryByText('Removed')).not.toBeInTheDocument()
  })

  it('shows the empty-diff NonIdealState when nothing operationally changed', async () => {
    const user = userEvent.setup()

    // Both snapshots identical modulo ignored fields (updated_at differs — should be stripped).
    mockGetSite.mockImplementation((_id: string, params?: { as_of?: string }) => {
      const updated = params?.as_of?.startsWith('2026-04-01')
        ? '2026-04-01T08:00:00Z'
        : '2026-04-15T08:00:00Z'
      return Promise.resolve(baseSite({ updated_at: updated }))
    })
    mockGetReadiness.mockResolvedValue([baseReadiness()])

    render(
      wrap(
        <SiteCompareTab
          siteId="site-1"
          openedAt="2026-04-01T08:00:00Z"
          latestAt="2026-04-15T08:00:00Z"
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: /Compare/i }))

    expect(await screen.findByText(/No site changes/i)).toBeInTheDocument()
    expect(screen.queryByText('updated at')).not.toBeInTheDocument()
  })

  it('shows the error callout when any of the four fetches fails', async () => {
    const user = userEvent.setup()

    mockGetSite.mockResolvedValue(baseSite())
    mockGetReadiness.mockImplementation((params?: { as_of?: string }) => {
      if (params?.as_of?.startsWith('2026-04-01')) return Promise.resolve([baseReadiness()])
      return Promise.reject(new Error('readiness snapshot unavailable'))
    })

    render(
      wrap(
        <SiteCompareTab
          siteId="site-1"
          openedAt="2026-04-01T08:00:00Z"
          latestAt="2026-04-15T08:00:00Z"
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: /Compare/i }))

    expect(await screen.findByText(/Could not load both snapshots/i)).toBeInTheDocument()
    expect(screen.getByText(/readiness snapshot unavailable/i)).toBeInTheDocument()
  })

  it('gracefully handles a missing readiness entry for this site at a given moment', async () => {
    const user = userEvent.setup()

    mockGetSite.mockResolvedValue(baseSite({ status: 'active' }))
    // Readiness endpoint returns readiness for other sites, not site-1.
    mockGetReadiness.mockResolvedValue([
      baseReadiness({ site_id: 'other-site', site_name: 'Other' }),
    ])

    render(
      wrap(
        <SiteCompareTab
          siteId="site-1"
          openedAt="2026-04-01T08:00:00Z"
          latestAt="2026-04-15T08:00:00Z"
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: /Compare/i }))

    // Both sides have no readiness for site-1 → readiness contributes no keys on either side,
    // site fields are identical, so the diff is empty. That's the correct honest answer;
    // we do not fabricate zero-counts the operator didn't ask for.
    expect(await screen.findByText(/No site changes/i)).toBeInTheDocument()
  })
})
