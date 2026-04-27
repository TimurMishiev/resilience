import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AuditEvent } from '../api/types'

// Mock useReplayParams so we can control the asOf the wrapper passes
// to useAuditEvents.
const useReplayParamsMock = vi.hoisted(() => vi.fn())
vi.mock('../hooks/useReplayParams', () => ({
  useReplayParams: () => useReplayParamsMock(),
}))

// Mock useAuditEvents directly. The wrapper renders the chain itself
// (no longer delegates to AuditTimeline) so the test asserts on the
// component's own DOM output.
type AuditQueryShape = {
  data?: AuditEvent[]
  error?: Error
  isPending: boolean
}
const useAuditEventsMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => AuditQueryShape>())
vi.mock('../hooks/useAuditEvents', () => ({
  useAuditEvents: (params: unknown) => useAuditEventsMock(params),
}))

import AuditChainAtTime from '../components/AuditChainAtTime'

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    schema_version: 1,
    actor: 'commander@example.com',
    entity_type: 'Site',
    entity_id: 'site-1',
    event_type: 'site_status_changed',
    action: 'flag',
    before_snapshot: { status: 'active' },
    after_snapshot: { status: 'flagged' },
    metadata: null,
    correlation_id: 'corr-1',
    occurred_at: '2026-04-20T12:34:56.000Z',
    ...overrides,
  }
}

describe('AuditChainAtTime — Tranche 6-C wrapper contract', () => {
  it('returns null when isReplaying is false AND issues no audit-events fetch (Codex round-3 P2 — live-mode contract)', () => {
    useReplayParamsMock.mockReset()
    useReplayParamsMock.mockReturnValue({ asOf: null })
    useAuditEventsMock.mockReset()
    useAuditEventsMock.mockReturnValue({ data: [], isPending: false })

    const { container } = render(
      <AuditChainAtTime entityType="Site" entityId="site-1" isReplaying={false} />,
    )

    expect(container.innerHTML).toBe('')
    expect(screen.queryByTestId('audit-chain-at-time')).not.toBeInTheDocument()
    // Outer/inner split: the body's hooks (useReplayParams, useAuditEvents)
    // never run in live mode because the body component is never mounted.
    // This locks the "live mode unchanged" contract — no hidden audit-events
    // fetch fires when the operator selects a Site/Asset in live mode.
    expect(useAuditEventsMock).not.toHaveBeenCalled()
    expect(useReplayParamsMock).not.toHaveBeenCalled()
  })

  it('passes asOf from useReplayParams and the entity props through to useAuditEvents while replaying', () => {
    useReplayParamsMock.mockReturnValue({ asOf: '2026-04-20T12:00:00.000Z' })
    useAuditEventsMock.mockReturnValue({ data: [], isPending: false })

    render(
      <AuditChainAtTime entityType="Asset" entityId="asset-7" isReplaying={true} />,
    )

    expect(useAuditEventsMock).toHaveBeenCalledWith({
      entity_type: 'Asset',
      entity_id: 'asset-7',
      limit: 50,
      as_of: '2026-04-20T12:00:00.000Z',
    })
  })

  it('renders an empty-state message inside the section shell when there are no events at this asOf', () => {
    useReplayParamsMock.mockReturnValue({ asOf: '2026-04-20T12:00:00.000Z' })
    useAuditEventsMock.mockReturnValue({ data: [], isPending: false })

    render(
      <AuditChainAtTime entityType="Site" entityId="site-1" isReplaying={true} />,
    )

    expect(screen.getByTestId('audit-chain-at-time')).toBeInTheDocument()
    expect(screen.getByText('No audit events recorded up to the replay timestamp.')).toBeInTheDocument()
  })

  it('renders a visible citation ID per audit event row (Tranche 6-C P1 — citeable chain-of-custody handle)', () => {
    useReplayParamsMock.mockReturnValue({ asOf: '2026-04-20T12:00:00.000Z' })
    useAuditEventsMock.mockReturnValue({
      data: [
        makeEvent({ id: 'aaaaaaaa-1111-2222-3333-444444444444' }),
        makeEvent({ id: 'bbbbbbbb-5555-6666-7777-888888888888', occurred_at: '2026-04-20T12:35:00.000Z' }),
      ],
      isPending: false,
    })

    render(
      <AuditChainAtTime entityType="Site" entityId="site-1" isReplaying={true} />,
    )

    const citations = screen.getAllByTestId('audit-chain-citation')
    expect(citations).toHaveLength(2)
    // Short form (first 8 chars of the UUID) is what the operator sees inline.
    expect(citations[0]).toHaveTextContent('aaaaaaaa')
    expect(citations[1]).toHaveTextContent('bbbbbbbb')
    // Full UUID is preserved on the title attribute for hover-disclosure
    // and copy. This is the load-bearing 6-C contract — the operator can
    // always reach the full audit-event handle, not just a truncation.
    expect(citations[0]).toHaveAttribute('title', 'aaaaaaaa-1111-2222-3333-444444444444')
    expect(citations[1]).toHaveAttribute('title', 'bbbbbbbb-5555-6666-7777-888888888888')
  })

  it('shows the event label and changed-keys summary alongside the citation', () => {
    useReplayParamsMock.mockReturnValue({ asOf: '2026-04-20T12:00:00.000Z' })
    useAuditEventsMock.mockReturnValue({
      data: [
        makeEvent({
          action: 'flag',
          before_snapshot: { status: 'active', updated_at: '2026-04-20T11:00:00.000Z' },
          after_snapshot:  { status: 'flagged', updated_at: '2026-04-20T12:00:00.000Z' },
        }),
      ],
      isPending: false,
    })

    render(
      <AuditChainAtTime entityType="Site" entityId="site-1" isReplaying={true} />,
    )

    // humanize() lowercases-and-spaces; visual capitalization comes from
    // the .audit-chain-label CSS rule, not the rendered string.
    expect(screen.getByText('flag')).toBeInTheDocument()
    // updated_at is filtered out of the changed-keys list; status remains.
    expect(screen.getByText('status')).toBeInTheDocument()
    expect(screen.getByTestId('audit-chain-row')).toBeInTheDocument()
  })

  it('shows the loading spinner while the audit-events query is pending', () => {
    useReplayParamsMock.mockReturnValue({ asOf: '2026-04-20T12:00:00.000Z' })
    useAuditEventsMock.mockReturnValue({ isPending: true })

    const { container } = render(
      <AuditChainAtTime entityType="Site" entityId="site-1" isReplaying={true} />,
    )

    expect(container.querySelector('.bp6-spinner')).not.toBeNull()
  })

  it('shows an error callout when the audit-events query errors', () => {
    useReplayParamsMock.mockReturnValue({ asOf: '2026-04-20T12:00:00.000Z' })
    useAuditEventsMock.mockReturnValue({ error: new Error('audit fetch failed'), isPending: false })

    render(
      <AuditChainAtTime entityType="Site" entityId="site-1" isReplaying={true} />,
    )

    expect(screen.getByText('audit fetch failed')).toBeInTheDocument()
  })
})
