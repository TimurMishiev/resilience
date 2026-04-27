import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Site, Task, SiteRiskScore } from '../api/types'

// Mock the alerts section so its useQuery wiring stays out of this test.
vi.mock('../components/MapSiteAlertsSection', () => ({
  MapSiteAlertsSection: () => <div data-testid="mock-map-site-alerts" />,
}))

// Mock AuditChainAtTime so the panel-integration test focuses on
// "is the wrapper plumbed into the panel layout?" without dragging in
// useAuditEvents / useReplayParams. The wrapper's own contract is
// covered by AuditChainAtTime.test.tsx.
const auditChainMock = vi.hoisted(() => vi.fn())
vi.mock('../components/AuditChainAtTime', () => ({
  default: (props: { entityType: string; entityId: string; isReplaying: boolean }) => {
    auditChainMock(props)
    return props.isReplaying
      ? <div data-testid="audit-chain-at-time" data-entity-type={props.entityType} data-entity-id={props.entityId} />
      : null
  },
}))

import { MapSitePanel } from '../components/MapSitePanel'

const site: Site = {
  id: 'site-1',
  name: 'Site Alpha',
  latitude: 51.5,
  longitude: 0.12,
  status: 'active',
  area_of_operation_id: 'ao-1',
  flagged_at: null,
  flag_reason: null,
  geofence_radius_km: 5,
  created_at: '2026-03-26T10:00:00.000Z',
  updated_at: '2026-03-26T10:00:00.000Z',
}

const tasks: Task[] = []
const riskBySiteId: Record<string, SiteRiskScore> = {}

const baseProps = {
  site,
  tasks,
  readiness: 0.5,
  riskBySiteId,
  isReplaying: false,
  role: 'commander' as const,
  canTriage: true,
  referenceTimeMs: 1_704_067_200_000,
  onSelectSignal: vi.fn(),
  onTransitioned: vi.fn(),
  onClose: vi.fn(),
}

describe('MapSitePanel — Tranche 6-C audit-chain integration', () => {
  it('does not render AuditChainAtTime in live mode', () => {
    auditChainMock.mockClear()

    render(<MapSitePanel {...baseProps} isReplaying={false} />)

    expect(screen.queryByTestId('audit-chain-at-time')).not.toBeInTheDocument()
    // The wrapper is still INVOKED with isReplaying=false — it just
    // returns null. That's the correct contract.
    expect(auditChainMock).toHaveBeenCalledWith({
      entityType: 'Site',
      entityId: 'site-1',
      isReplaying: false,
    })
  })

  it('renders AuditChainAtTime with the right entity props during replay', () => {
    auditChainMock.mockClear()

    render(<MapSitePanel {...baseProps} isReplaying={true} />)

    const node = screen.getByTestId('audit-chain-at-time')
    expect(node.getAttribute('data-entity-type')).toBe('Site')
    expect(node.getAttribute('data-entity-id')).toBe('site-1')
    expect(auditChainMock).toHaveBeenCalledWith({
      entityType: 'Site',
      entityId: 'site-1',
      isReplaying: true,
    })
  })
})
