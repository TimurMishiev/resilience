import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppBanners } from '../components/shell/AppBanners'
import type { SourceHealthState } from '../hooks/useSourceHealth'

const fresh: SourceHealthState = { sse: 'fresh', data: 'fresh', aggregate: 'fresh' }

function renderBanners(overrides: Partial<Parameters<typeof AppBanners>[0]> = {}) {
  return render(
    <AppBanners
      isOnline={true}
      isReplaying={false}
      asOf={null}
      sourceHealth={fresh}
      {...overrides}
    />,
  )
}

describe('AppBanners', () => {
  it('renders no banners when everything is healthy', () => {
    const { container } = renderBanners()
    expect(container.querySelector('.bp5-callout, .bp6-callout')).toBeNull()
  })

  it('renders offline banner when not online', () => {
    renderBanners({ isOnline: false })
    expect(screen.getByText(/OFFLINE/)).toBeInTheDocument()
  })

  it('renders replay banner when replaying', () => {
    renderBanners({ isReplaying: true, asOf: '2026-04-10T12:00:00Z' })
    expect(screen.getByText(/Viewing historical state/)).toBeInTheDocument()
  })

  it('renders degraded banner mentioning SSE when only SSE is stale', () => {
    const stale: SourceHealthState = { sse: 'stale', data: 'fresh', aggregate: 'stale' }
    renderBanners({ sourceHealth: stale })
    expect(screen.getByText(/live event stream disconnected/)).toBeInTheDocument()
    expect(screen.queryByText(/data feed is stale/)).not.toBeInTheDocument()
  })

  it('renders degraded banner mentioning both when SSE and data are stale', () => {
    const bothStale: SourceHealthState = { sse: 'stale', data: 'stale', aggregate: 'stale' }
    renderBanners({ sourceHealth: bothStale })
    expect(screen.getByText(/live event stream disconnected and data feed is stale/)).toBeInTheDocument()
  })

  it('renders degraded banner with data message when data is stale but SSE is fine', () => {
    const dataStale: SourceHealthState = { sse: 'fresh', data: 'stale', aggregate: 'stale' }
    renderBanners({ sourceHealth: dataStale })
    expect(screen.getByText(/data feed has not refreshed recently/)).toBeInTheDocument()
  })

  it('renders degraded banner when aggregate is unavailable', () => {
    const unavailable: SourceHealthState = { sse: 'fresh', data: 'unavailable', aggregate: 'unavailable' }
    renderBanners({ sourceHealth: unavailable })
    expect(screen.getByText(/no recent data is available yet/)).toBeInTheDocument()
    expect(screen.queryByText(/data feed is stale/)).not.toBeInTheDocument()
  })

  it('renders unavailable message when the stream is stale and no data is available', () => {
    const unavailable: SourceHealthState = { sse: 'stale', data: 'unavailable', aggregate: 'unavailable' }
    renderBanners({ sourceHealth: unavailable })
    expect(screen.getByText(/live event stream disconnected and no recent data is available/)).toBeInTheDocument()
    expect(screen.queryByText(/data feed is stale/)).not.toBeInTheDocument()
  })

  it('renders aging banner when aggregate is aging', () => {
    const aging: SourceHealthState = { sse: 'aging', data: 'fresh', aggregate: 'aging' }
    renderBanners({ sourceHealth: aging })
    expect(screen.getByText(/Some data sources are delayed/)).toBeInTheDocument()
  })

  it('does not render degraded banner during replay', () => {
    const stale: SourceHealthState = { sse: 'stale', data: 'stale', aggregate: 'stale' }
    renderBanners({ isReplaying: true, asOf: '2026-04-10T12:00:00Z', sourceHealth: stale })
    expect(screen.queryByText(/Data may be outdated/)).not.toBeInTheDocument()
    expect(screen.getByText(/Viewing historical state/)).toBeInTheDocument()
  })

  it('does not render aging banner during replay', () => {
    const aging: SourceHealthState = { sse: 'aging', data: 'fresh', aggregate: 'aging' }
    renderBanners({ isReplaying: true, asOf: '2026-04-10T12:00:00Z', sourceHealth: aging })
    expect(screen.queryByText(/Some data sources are delayed/)).not.toBeInTheDocument()
  })
})
