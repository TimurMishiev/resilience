import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const timelineState = vi.hoisted(() => ({
  dataUpdatedAt: Date.parse('2026-04-15T14:45:00Z'),
  response: {
    data: [
      {
        id: 'event-1',
        event_kind: 'site_event',
        occurred_at: '2026-04-15T14:30:00Z',
        title: 'Perimeter check completed',
        subtitle: 'South quay',
        actor: 'operator@resilience.test',
        meta: {},
        confidence: null,
        workflow_status: null,
      },
    ],
    meta: {
      total: 1,
      site_id: 'site-1',
      kinds: ['site_event'],
      days: 7,
    },
  },
}))

const referenceTimeState = vi.hoisted(() => ({
  now: Date.parse('2026-04-15T15:00:00Z'),
}))

vi.mock('../hooks/useSite', () => ({
  useSiteTimeline: () => ({
    data: timelineState.response,
    isPending: false,
    error: null,
    dataUpdatedAt: timelineState.dataUpdatedAt,
  }),
}))

vi.mock('../hooks/useReferenceTimeMs', () => ({
  useReferenceTimeMs: () => referenceTimeState.now,
}))

import SiteTimeline from '../components/SiteTimeline'

describe('SiteTimeline trust semantics', () => {
  beforeEach(() => {
    referenceTimeState.now = Date.parse('2026-04-15T15:00:00Z')
    timelineState.dataUpdatedAt = Date.parse('2026-04-15T14:45:00Z')
    timelineState.response = {
      data: [
        {
          id: 'event-1',
          event_kind: 'site_event',
          occurred_at: '2026-04-15T14:30:00Z',
          title: 'Perimeter check completed',
          subtitle: 'South quay',
          actor: 'operator@resilience.test',
          meta: {},
          confidence: null,
          workflow_status: null,
        },
      ],
      meta: {
        total: 1,
        site_id: 'site-1',
        kinds: ['site_event'],
        days: 7,
      },
    }
  })

  it('uses the shared live reference time for event and update recency', () => {
    render(<SiteTimeline siteId="site-1" />)

    expect(screen.getByText(/1 event · last 7 days · updated 15m ago/i)).toBeInTheDocument()
    expect(screen.getByText('30m ago')).toBeInTheDocument()
  })

  it('anchors replay summaries to the replay timestamp instead of wall-clock time', () => {
    referenceTimeState.now = Date.parse('2026-04-09T12:00:00Z')
    timelineState.dataUpdatedAt = Date.parse('2026-04-15T15:00:00Z')
    timelineState.response.data[0].occurred_at = '2026-04-09T11:30:00Z'

    render(<SiteTimeline siteId="site-1" asOf="2026-04-09T12:00:00Z" />)

    expect(screen.getByText(/1 event · last 7 days · anchored/i)).toBeInTheDocument()
    expect(screen.getByText(/fetched Apr/i)).toBeInTheDocument()
    expect(screen.getByText('30m ago')).toBeInTheDocument()
  })
})
