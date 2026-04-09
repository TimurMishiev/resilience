import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const replayState = vi.hoisted(() => ({
  isReplaying: true,
  asOf: '2026-04-08T12:00:00Z',
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
    data: {
      id: 'asset-1',
      name: 'Raven-1',
      asset_type: 'drone',
      status: 'available',
      home_site_id: 'site-1',
      last_reported_at: '2026-04-08T11:30:00Z',
      created_at: '2026-04-08T09:00:00Z',
      updated_at: '2026-04-08T11:45:00Z',
    },
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
})
