import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
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
  useMapLibreEngine: () => {
    return {
      mapLoaded: true,
      flyTo: vi.fn(),
    }
  },
}))

vi.mock('../components/MapSitePanel', () => ({
  MapSitePanel: () => null,
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

function renderMapPage(initialEntry = '/map') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  const renderTree = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
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

describe('MapPage signal selection', () => {
  beforeEach(() => {
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
