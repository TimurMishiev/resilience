import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  signals: [
    {
      id: 'sig-1',
      signal_type: 'disaster_alert',
      source: 'gdacs',
      lat: 10,
      lng: 20,
      occurred_at: '2026-03-24T00:00:00Z',
      external_id: null,
      raw_payload: { version: 'v1', name: 'Initial alert' },
    },
  ],
}))

const engineState = vi.hoisted(() => ({
  flyTo: vi.fn(),
  latestInput: null as null | {
    onSiteClick: (siteId: string | null) => void
    onAssetClick: (assetId: string | null) => void
    onSignalClick: (signalId: string | null) => void
  },
}))

vi.mock('../hooks/useSites', () => ({
  useSites: () => ({
    data: { data: [{ id: 'site-1', name: 'Site One', latitude: 1, longitude: 2, status: 'active', geofence_radius_km: 0 }] },
    isLoading: false,
    error: null,
  }),
}))

vi.mock('../hooks/useTasks', () => ({
  useTasks: () => ({
    data: { data: [] },
    isLoading: false,
    error: null,
  }),
}))

vi.mock('../hooks/useAssets', () => ({
  useAssets: () => ({
    data: { data: [] },
    isLoading: false,
    error: null,
  }),
}))

vi.mock('../hooks/useTelemetry', () => ({
  useTelemetry: () => ({
    readings: new Map(),
    connected: true,
  }),
}))

vi.mock('../hooks/useAreasOfOperation', () => ({
  useAreasOfOperation: () => ({
    data: { data: [] },
  }),
}))

vi.mock('../hooks/useSignals', () => ({
  useSignalsLive: () => ({
    signals: mockState.signals,
    error: null,
  }),
}))

vi.mock('../hooks/useVessels', () => ({
  useVessels: () => ({
    data: { data: [] },
  }),
  useVesselTracks: () => ({
    data: { data: [] },
  }),
}))

vi.mock('../hooks/useRiskScores', () => ({
  useRiskScores: () => ({
    data: [],
  }),
}))

vi.mock('../hooks/useSignalRuleMatches', () => ({
  useActiveBreachSiteIds: () => ({
    data: { site_ids: [] },
  }),
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => ({
    role: 'commander',
  }),
}))

vi.mock('../hooks/useReplayParams', () => ({
  useReplayParams: () => ({
    asOf: null,
    isReplaying: false,
    asOfParam: {},
    signalQueryParams: {},
  }),
}))

vi.mock('../hooks/useMapLibreEngine', () => ({
  MAP_STYLE_CONFIGS: {
    tactical: { label: 'Tactical', style: {} },
    satellite: { label: 'Satellite', style: {} },
    street: { label: 'Street', style: {} },
  },
  useMapLibreEngine: (input: {
    onSiteClick: (siteId: string | null) => void
    onAssetClick: (assetId: string | null) => void
    onSignalClick: (signalId: string | null) => void
  }) => {
    engineState.latestInput = input
    return {
      mapLoaded: true,
      flyTo: engineState.flyTo,
      getZoom: vi.fn(() => 1.5),
      projectPosition: vi.fn(),
      inspectCanvasPosition: vi.fn(() => null),
    }
  },
}))

vi.mock('../components/MapSitePanel', () => ({
  MapSitePanel: ({ site }: { site: { name: string } }) => (
    <div data-testid="map-site-panel">{site.name}</div>
  ),
}))

vi.mock('../components/MapAssetPanel', () => ({
  MapAssetPanel: () => null,
}))

vi.mock('../components/MapSignalPanel', () => ({
  MapSignalPanel: ({ signal }: { signal: { raw_payload: { version: string } } }) => (
    <div data-testid="map-signal-panel">
      <span data-testid="signal-version">{signal.raw_payload.version}</span>
    </div>
  ),
}))

import MapPage from '../pages/MapPage'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location-search">{location.search}</div>
}

function renderMapPage(initialEntry = '/map') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  const renderTree = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <MapPage />
      </MemoryRouter>
    </QueryClientProvider>
  )

  return {
    queryClient,
    ...render(renderTree()),
    renderTree,
  }
}

describe('MapPage selection routing', () => {
  beforeEach(() => {
    engineState.flyTo.mockReset()
    engineState.latestInput = null
    mockState.signals = [
      {
        id: 'sig-1',
        signal_type: 'disaster_alert',
        source: 'gdacs',
        lat: 10,
        lng: 20,
        occurred_at: '2026-03-24T00:00:00Z',
        external_id: null,
        raw_payload: { version: 'v1', name: 'Initial alert' },
      },
    ]
    window.localStorage.clear()
  })

  it('hydrates the selected site panel from the route', async () => {
    renderMapPage('/map?site_id=site-1')
    expect(await screen.findByTestId('map-site-panel')).toHaveTextContent('Site One')
    expect(engineState.flyTo).toHaveBeenCalledWith([2, 1], 6)
  })

  it('keeps the selected site panel open after route sync writes selection into the URL without self-focusing the map', async () => {
    renderMapPage('/map')

    expect(engineState.latestInput).not.toBeNull()

    await act(async () => {
      engineState.latestInput?.onSiteClick('site-1')
    })

    expect(await screen.findByTestId('location-search')).toHaveTextContent('?site_id=site-1')
    expect(await screen.findByTestId('map-site-panel')).toHaveTextContent('Site One')

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByTestId('map-site-panel')).toHaveTextContent('Site One')
    expect(engineState.flyTo).not.toHaveBeenCalled()
  })

  it('re-derives the selected signal from the live collection on refresh', async () => {
    const view = renderMapPage('/map?signal_id=sig-1')

    expect(await screen.findByTestId('signal-version')).toHaveTextContent('v1')

    mockState.signals = [
      {
        id: 'sig-1',
        signal_type: 'disaster_alert',
        source: 'gdacs',
        lat: 11,
        lng: 21,
        occurred_at: '2026-03-24T00:01:00Z',
        external_id: null,
        raw_payload: { version: 'v2', name: 'Escalated alert' },
      },
    ]

    view.rerender(view.renderTree())

    expect(await screen.findByTestId('signal-version')).toHaveTextContent('v2')
  })
})
