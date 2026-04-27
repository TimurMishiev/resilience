import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Asset } from '../api/types'

vi.mock('../components/MapSiteAlertsSection', () => ({
  MapSiteAlertsSection: () => <div data-testid="mock-map-site-alerts" />,
}))

const auditChainMock = vi.hoisted(() => vi.fn())
vi.mock('../components/AuditChainAtTime', () => ({
  default: (props: { entityType: string; entityId: string; isReplaying: boolean }) => {
    auditChainMock(props)
    return props.isReplaying
      ? <div data-testid="audit-chain-at-time" data-entity-type={props.entityType} data-entity-id={props.entityId} />
      : null
  },
}))

import { MapAssetPanel } from '../components/MapAssetPanel'

const asset: Asset = {
  id: 'asset-1',
  name: 'Guardian-1',
  asset_type: 'vehicle',
  status: 'available',
  home_site_id: 'site-1',
  last_reported_at: null,
  created_at: '2026-03-26T10:00:00.000Z',
  updated_at: '2026-03-26T10:00:00.000Z',
}

const baseProps = {
  asset,
  liveReading: null,
  isReplaying: false,
  canTriage: true,
  referenceTimeMs: 1_704_067_200_000,
  onSelectHomeSite: vi.fn(),
  onSelectSignal: vi.fn(),
  onClose: vi.fn(),
}

describe('MapAssetPanel — Tranche 6-C audit-chain integration', () => {
  it('does not render AuditChainAtTime in live mode', () => {
    auditChainMock.mockClear()

    render(<MapAssetPanel {...baseProps} isReplaying={false} />)

    expect(screen.queryByTestId('audit-chain-at-time')).not.toBeInTheDocument()
    expect(auditChainMock).toHaveBeenCalledWith({
      entityType: 'Asset',
      entityId: 'asset-1',
      isReplaying: false,
    })
  })

  it('renders AuditChainAtTime with the right entity props during replay', () => {
    auditChainMock.mockClear()

    render(<MapAssetPanel {...baseProps} isReplaying={true} />)

    const node = screen.getByTestId('audit-chain-at-time')
    expect(node.getAttribute('data-entity-type')).toBe('Asset')
    expect(node.getAttribute('data-entity-id')).toBe('asset-1')
    expect(auditChainMock).toHaveBeenCalledWith({
      entityType: 'Asset',
      entityId: 'asset-1',
      isReplaying: true,
    })
  })
})
