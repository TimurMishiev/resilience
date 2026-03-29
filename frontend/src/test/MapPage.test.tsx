import { useEffect } from 'react'
import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  sites: [
    { id: 'site-1', name: 'Site One', latitude: 1, longitude: 2, status: 'active', geofence_radius_km: 0 },
  ],
  assets: [
    {
      id: 'asset-1',
      name: 'Asset One',
      asset_type: 'vehicle',
      status: 'available',
      home_site_id: 'site-1',
      last_reported_at: null,
      created_at: '2026-03-24T00:00:00Z',
      updated_at: '2026-03-24T00:00:00Z',
    },
  ],
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

const mockChokepoints = vi.hoisted(() => ({
  data: [
    {
      id: 'cp-1',
      name: 'Narrows',
      status: 'monitor',
      category: 'strait',
      latitude: 12,
      longitude: 22,
      watch_radius_km: 40,
      area_of_operation_id: 'ao-1',
      area_of_operation_name: 'AO One',
      notes: null,
      created_by_id: 'user-1',
      updated_by_id: 'user-1',
      created_at: '2026-03-24T00:00:00Z',
      updated_at: '2026-03-24T00:00:00Z',
    },
  ],
}))

const mockReplay = vi.hoisted(() => ({
  asOf: null as string | null,
  isReplaying: false,
  asOfParam: {} as Record<string, string>,
  signalQueryParams: {} as Record<string, string>,
}))

const engineState = vi.hoisted(() => ({
  flyTo: vi.fn(),
  latestInput: null as null | {
    showSignals: boolean
    showHeatmap: boolean
    showChokepoints: boolean
    chokepoints: Array<{ id: string }>
    onSiteClick: (siteId: string | null) => void
    onAssetClick: (assetId: string | null) => void
    onSignalClick: (signalId: string | null) => void
  },
}))

const routerState = vi.hoisted(() => ({
  navigate: null as null | ((to: string) => void),
}))

vi.mock('../hooks/useSites', () => ({
  useSites: () => ({
    data: { data: mockState.sites },
    isLoading: false,
    isSuccess: true,
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
    data: { data: mockState.assets },
    isLoading: false,
    isSuccess: true,
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

vi.mock('../hooks/useChokepoints', () => ({
  useChokepoints: () => ({
    data: { data: mockChokepoints.data },
  }),
}))

vi.mock('../hooks/useSignals', () => ({
  useSignalsLive: () => ({
    signals: mockState.signals,
    isPending: false,
    connected: true,
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
  useReplayParams: () => mockReplay,
}))

vi.mock('../hooks/useMapLibreEngine', () => ({
  MAP_STYLE_CONFIGS: {
    tactical: { label: 'Tactical', style: {} },
    satellite: { label: 'Satellite', style: {} },
    street: { label: 'Street', style: {} },
  },
  useMapLibreEngine: (input: {
    showSignals: boolean
    showHeatmap: boolean
    showChokepoints: boolean
    chokepoints: Array<{ id: string }>
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
  MapAssetPanel: ({ asset }: { asset: { name: string } }) => (
    <div data-testid="map-asset-panel">{asset.name}</div>
  ),
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

function ExternalNavigatorProbe() {
  const navigate = useNavigate()

  useEffect(() => {
    routerState.navigate = navigate
    return () => {
      routerState.navigate = null
    }
  }, [navigate])

  return null
}

function renderMapPage(initialEntry = '/map') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  window.history.replaceState(null, '', initialEntry)

  const renderTree = () => (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ExternalNavigatorProbe />
        <LocationProbe />
        <MapPage />
      </BrowserRouter>
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
    routerState.navigate = null
    mockState.sites = [
      { id: 'site-1', name: 'Site One', latitude: 1, longitude: 2, status: 'active', geofence_radius_km: 0 },
    ]
    mockState.assets = [
      {
        id: 'asset-1',
        name: 'Asset One',
        asset_type: 'vehicle',
        status: 'available',
        home_site_id: 'site-1',
        last_reported_at: null,
        created_at: '2026-03-24T00:00:00Z',
        updated_at: '2026-03-24T00:00:00Z',
      },
    ]
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
    mockChokepoints.data = [
      {
        id: 'cp-1',
        name: 'Narrows',
        status: 'monitor',
        category: 'strait',
        latitude: 12,
        longitude: 22,
        watch_radius_km: 40,
        area_of_operation_id: 'ao-1',
        area_of_operation_name: 'AO One',
        notes: null,
        created_by_id: 'user-1',
        updated_by_id: 'user-1',
        created_at: '2026-03-24T00:00:00Z',
        updated_at: '2026-03-24T00:00:00Z',
      },
    ]
    mockReplay.asOf = null
    mockReplay.isReplaying = false
    mockReplay.asOfParam = {}
    mockReplay.signalQueryParams = {}
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
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

  it('clears a stale site selection and route when the backing site disappears after load', async () => {
    const view = renderMapPage('/map?site_id=site-1')

    expect(await screen.findByTestId('map-site-panel')).toHaveTextContent('Site One')
    expect(screen.getByTestId('location-search')).toHaveTextContent('?site_id=site-1')

    mockState.sites = []
    view.rerender(view.renderTree())

    expect(await screen.findByTestId('location-search')).toBeEmptyDOMElement()
    expect(screen.queryByTestId('map-site-panel')).not.toBeInTheDocument()
  })

  it('clears a stale asset selection and route when the backing asset disappears after load', async () => {
    const view = renderMapPage('/map?asset_id=asset-1')

    expect(await screen.findByTestId('map-asset-panel')).toHaveTextContent('Asset One')
    expect(screen.getByTestId('location-search')).toHaveTextContent('?asset_id=asset-1')

    mockState.assets = []
    view.rerender(view.renderTree())

    expect(await screen.findByTestId('location-search')).toBeEmptyDOMElement()
    expect(screen.queryByTestId('map-asset-panel')).not.toBeInTheDocument()
  })

  it('preserves a deep-linked signal route while SSE has not yet delivered the signal', async () => {
    // Simulate the race: baseline completes (connected=true) but the deep-linked
    // signal has not yet arrived via SSE.  The clear effect must not destroy the
    // URL before the signal has had a fair chance to arrive.
    vi.useFakeTimers()
    mockState.signals = []

    const view = renderMapPage('/map?signal_id=sig-1')

    // Immediately after load the URL must still carry the signal deep-link.
    expect(screen.getByTestId('location-search')).toHaveTextContent('?signal_id=sig-1')

    // SSE delivers the signal — simulate by adding it to the mock and re-rendering.
    mockState.signals = [
      {
        id: 'sig-1',
        signal_type: 'disaster_alert',
        source: 'gdacs',
        lat: 10,
        lng: 20,
        occurred_at: '2026-03-24T00:00:00Z',
        external_id: null,
        raw_payload: { version: 'v1', name: 'SSE delivered' },
      },
    ]
    await act(async () => {
      view.rerender(view.renderTree())
    })

    expect(screen.getByTestId('map-signal-panel')).toBeInTheDocument()
    expect(screen.getByTestId('location-search')).toHaveTextContent('?signal_id=sig-1')
  })

  it('clears a deep-linked signal route after the SSE grace period expires with no delivery', async () => {
    // Signal is deep-linked but never arrives.  After 1500 ms the system must
    // treat the signal as genuinely missing and clean up the stale URL.
    vi.useFakeTimers()
    mockState.signals = []

    renderMapPage('/map?signal_id=sig-never')

    expect(screen.getByTestId('location-search')).toHaveTextContent('?signal_id=sig-never')

    await act(async () => {
      vi.advanceTimersByTime(1500)
    })

    expect(screen.getByTestId('location-search')).toBeEmptyDOMElement()
  })

  it('clears a selected signal and route when the backing signal disappears after load', async () => {
    const view = renderMapPage('/map?signal_id=sig-1')

    expect(await screen.findByTestId('map-signal-panel')).toBeInTheDocument()
    expect(screen.getByTestId('location-search')).toHaveTextContent('?signal_id=sig-1')

    mockState.signals = []
    view.rerender(view.renderTree())

    expect(await screen.findByTestId('location-search')).toBeEmptyDOMElement()
    expect(screen.queryByTestId('map-signal-panel')).not.toBeInTheDocument()
  })

  it('toggles the heatmap control and legend independently of the signal legend', async () => {
    renderMapPage('/map')

    const heatmapToggle = screen.getByRole('button', { name: 'Toggle signal heatmap' })

    expect(heatmapToggle).toHaveTextContent('HEATMAP OFF')
    expect(screen.queryByText('LOW DENSITY')).not.toBeInTheDocument()
    expect(engineState.latestInput?.showHeatmap).toBe(false)

    await act(async () => {
      heatmapToggle.click()
    })

    expect(heatmapToggle).toHaveTextContent('HEATMAP ON')
    expect(screen.getByText('LOW DENSITY')).toBeInTheDocument()
    expect(screen.getByText('HIGH DENSITY')).toBeInTheDocument()
    expect(engineState.latestInput?.showHeatmap).toBe(true)
  })

  it('keeps the heatmap legend hidden when the signal layer is turned off', async () => {
    renderMapPage('/map')

    const heatmapToggle = screen.getByRole('button', { name: 'Toggle signal heatmap' })
    const signalToggle = screen.getByRole('button', { name: 'Toggle signal layer' })

    await act(async () => {
      heatmapToggle.click()
    })

    expect(screen.getByText('LOW DENSITY')).toBeInTheDocument()

    await act(async () => {
      signalToggle.click()
    })

    expect(screen.queryByText('LOW DENSITY')).not.toBeInTheDocument()
    expect(screen.queryByText('HIGH DENSITY')).not.toBeInTheDocument()
    expect(engineState.latestInput?.showSignals).toBe(false)
    expect(engineState.latestInput?.showHeatmap).toBe(true)
  })

  it('toggles the chokepoint overlay and legend through page state', async () => {
    renderMapPage('/map')

    const chokepointToggle = screen.getByRole('button', { name: 'Toggle chokepoint overlay' })

    expect(chokepointToggle).toHaveTextContent('CHOKEPOINTS ON')
    expect(screen.getByText('Monitor')).toBeInTheDocument()
    expect(engineState.latestInput?.showChokepoints).toBe(true)
    expect(engineState.latestInput?.chokepoints).toHaveLength(1)

    await act(async () => {
      chokepointToggle.click()
    })

    expect(chokepointToggle).toHaveTextContent('CHOKEPOINTS OFF')
    expect(screen.queryByText('Monitor')).not.toBeInTheDocument()
    expect(engineState.latestInput?.showChokepoints).toBe(false)
  })

  it('hides chokepoint controls and clears chokepoint data during replay', async () => {
    mockReplay.asOf = '2026-03-24T12:00'
    mockReplay.isReplaying = true
    mockReplay.asOfParam = { as_of: mockReplay.asOf }
    mockReplay.signalQueryParams = { as_of: mockReplay.asOf }

    renderMapPage('/map')

    expect(screen.queryByRole('button', { name: 'Toggle chokepoint overlay' })).not.toBeInTheDocument()
    expect(screen.queryByText('Monitor')).not.toBeInTheDocument()
    expect(engineState.latestInput?.chokepoints).toEqual([])
    expect(screen.getByText(/AO overlays, chokepoint overlays,/i)).toBeInTheDocument()
  })

  it('gives an external same-signal retry a fresh SSE grace window in a long-lived session', async () => {
    // Regression guard: after one signal deep-link times out, an external
    // navigation back to the SAME signal must get a fresh route attempt and
    // must not be cleared immediately in the same connected session.
    vi.useFakeTimers()
    mockState.signals = []

    // Phase 1 — advance the grace window past sig-a so signalsSettledKey = key-for-sig-a.
    renderMapPage('/map?signal_id=sig-a')
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(screen.getByTestId('location-search')).toBeEmptyDOMElement()

    // Phase 2 — external same-signal retry via router.navigate, not an engine
    // callback. This keeps routeAuthoritative=true and proves the location.key
    // grace rather than the self-authored route-sync path.
    expect(routerState.navigate).not.toBeNull()
    await act(async () => {
      routerState.navigate?.('/map?signal_id=sig-a')
    })

    expect(screen.getByTestId('location-search')).toHaveTextContent('?signal_id=sig-a')
  })
})
