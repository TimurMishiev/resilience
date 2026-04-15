import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const replayState = vi.hoisted(() => ({
  isReplaying: true,
  asOf: '2026-04-08T12:00:00Z',
}))

const referenceTimeState = vi.hoisted(() => ({
  now: Date.parse('2026-04-08T12:00:00Z'),
}))

const assetState = vi.hoisted(() => ({
  asset: {
    id: 'asset-1',
    name: 'Raven-1',
    asset_type: 'drone',
    status: 'available',
    home_site_id: 'site-1',
    last_reported_at: '2026-04-08T11:30:00Z' as string | null,
    created_at: '2026-04-08T09:00:00Z',
    updated_at: '2026-04-08T11:45:00Z',
  },
}))

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => replayState,
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => ({
    role: 'commander',
    isCommander: true,
    isOperator: false,
    isViewer: false,
  }),
}))

vi.mock('../hooks/useTasks', () => ({
  useTask: () => ({ data: null, isPending: false }),
  useTasks: () => ({ data: { data: [] }, isPending: false }),
  useAllowedTransitions: () => ({ data: { allowed: [], commander_only: [] } }),
  useTransitionTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('../hooks/useAssets', () => ({
  useAsset: () => ({
    data: assetState.asset,
    isPending: false,
  }),
  useAssets: () => ({ data: { data: [] }, isPending: false }),
  useUpdateAssetStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../hooks/useSite', () => ({
  useSite: () => ({ data: null, isPending: false }),
}))

vi.mock('../hooks/useAreasOfOperation', () => ({
  useAreaOfOperation: () => ({ data: null, isPending: false }),
  useAreasOfOperation: () => ({ data: { data: [] }, isPending: false }),
}))

vi.mock('../hooks/useSites', () => ({
  useSites: () => ({
    data: {
      data: [{ id: 'site-1', name: 'Port Sentinel' }],
    },
    isPending: false,
  }),
}))

vi.mock('../hooks/useReferenceTimeMs', () => ({
  useReferenceTimeMs: () => referenceTimeState.now,
}))

vi.mock('../components/AuditTimeline', () => ({
  default: ({ asOf }: { asOf?: string | null }) => <div>{`audit:${asOf ?? 'live'}`}</div>,
}))

vi.mock('../components/AssetPicker', () => ({
  AssetPicker: () => null,
}))

vi.mock('../components/PostureBadge', () => ({
  PostureBadge: () => null,
}))

import EntityCard from '../components/EntityCard'

describe('EntityCard replay parity', () => {
  beforeEach(() => {
    replayState.isReplaying = true
    replayState.asOf = '2026-04-08T12:00:00Z'
    referenceTimeState.now = Date.parse('2026-04-08T12:00:00Z')
    assetState.asset = {
      id: 'asset-1',
      name: 'Raven-1',
      asset_type: 'drone',
      status: 'available',
      home_site_id: 'site-1',
      last_reported_at: '2026-04-08T11:30:00Z',
      created_at: '2026-04-08T09:00:00Z',
      updated_at: '2026-04-08T11:45:00Z',
    }
  })

  it('renders read-only replay detail instead of the blanket unavailable callout', async () => {
    const user = userEvent.setup()

    render(<EntityCard entityType="asset" entityId="asset-1" />)

    expect(screen.getByText(/viewing entity state as it existed at the replay timestamp/i)).toBeInTheDocument()
    expect(screen.getByText('available')).toBeInTheDocument()
    expect(screen.queryByText(/entity detail drawers are unavailable during replay/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/change status/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Activity' }))

    expect(screen.getByText('audit:2026-04-08T12:00:00Z')).toBeInTheDocument()
  })

  it('uses shared freshness thresholds for aging and stale asset tags', () => {
    assetState.asset.last_reported_at = '2026-04-08T05:00:00Z'

    const { rerender } = render(<EntityCard entityType="asset" entityId="asset-1" />)

    expect(screen.getByText('Updated 7h ago')).toBeInTheDocument()

    assetState.asset.last_reported_at = '2026-04-06T12:00:00Z'
    rerender(<EntityCard entityType="asset" entityId="asset-1" />)

    expect(screen.getByText('Updated 2d ago')).toBeInTheDocument()
  })

  it('falls back to updated_at when last_reported_at is null', () => {
    assetState.asset.last_reported_at = null
    assetState.asset.updated_at = '2026-04-08T04:00:00Z'

    render(<EntityCard entityType="asset" entityId="asset-1" />)

    expect(screen.getByText('Updated 8h ago')).toBeInTheDocument()
  })

  it('shows unknown when both asset timestamps are invalid', () => {
    assetState.asset.last_reported_at = 'not-a-date'
    assetState.asset.updated_at = 'garbage'

    render(<EntityCard entityType="asset" entityId="asset-1" />)

    expect(screen.getByText('Updated unknown')).toBeInTheDocument()
  })
})
