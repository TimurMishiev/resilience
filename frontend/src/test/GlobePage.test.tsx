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
  signals: [] as Array<{
    id: string
    signal_type: string
    source: string
    lat: number
    lng: number
    occurred_at: string
    external_id: null
    raw_payload: Record<string, unknown>
  }>,
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

vi.mock('../hooks/useSignalRuleMatches', () => ({
  useActiveBreachSiteIds: () => ({
    data: { site_ids: [] },
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

const globeEngineState = vi.hoisted(() => ({
  onSiteClick: null as ((siteId: string | null) => void) | null,
  onAssetClick: null as ((assetId: string | null) => void) | null,
  onSignalClick: null as ((signalId: string | null) => void) | null,
}))

const routerState = vi.hoisted(() => ({
  navigate: null as null | ((to: string) => void),
}))

vi.mock('../hooks/useGlobeEngine', () => ({
  useGlobeEngine: (input: {
    onSiteClick?: (siteId: string | null) => void
    onAssetClick?: (assetId: string | null) => void
    onSignalClick?: (signalId: string | null) => void
  }) => {
    globeEngineState.onSiteClick = input.onSiteClick ?? null
    globeEngineState.onAssetClick = input.onAssetClick ?? null
    globeEngineState.onSignalClick = input.onSignalClick ?? null
    return {
      viewerReady: true,
      isCloseView: false,
      focusPosition: vi.fn(),
      flyToHome: vi.fn(),
      projectRenderedPosition: vi.fn(() => null),
      inspectCanvasPosition: vi.fn(() => ({ outcome: 'miss' })),
      dispatchSyntheticPick: vi.fn(() => false),
      pickCanvasPosition: vi.fn(() => null),
    }
  },
}))

vi.mock('../components/GlobeInspectorPanel', () => ({
  GlobeInspectorPanel: ({ inspectorTitle }: { inspectorTitle: string }) => (
    <div data-testid="globe-inspector-panel">{inspectorTitle}</div>
  ),
}))

import GlobePage from '../pages/GlobePage'

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

function renderGlobePage(initialEntry = '/globe') {
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
        <GlobePage />
      </BrowserRouter>
    </QueryClientProvider>
  )

  return {
    queryClient,
    ...render(renderTree()),
    renderTree,
  }
}

describe('GlobePage selection routing', () => {
  beforeEach(() => {
    globeEngineState.onSiteClick = null
    globeEngineState.onAssetClick = null
    globeEngineState.onSignalClick = null
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
    mockState.signals = []
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the selected site inspector open after a self-authored route sync writes selection into the URL', async () => {
    renderGlobePage('/globe')

    expect(globeEngineState.onSiteClick).not.toBeNull()

    await act(async () => {
      globeEngineState.onSiteClick?.('site-1')
    })

    expect(await screen.findByTestId('location-search')).toHaveTextContent('?site_id=site-1')
    expect(await screen.findByTestId('globe-inspector-panel')).toHaveTextContent('Site One')
  })

  it('clears the selected site route and inspector when the engine emits a deselect click', async () => {
    renderGlobePage('/globe')

    await act(async () => {
      globeEngineState.onSiteClick?.('site-1')
    })

    expect(await screen.findByTestId('location-search')).toHaveTextContent('?site_id=site-1')
    expect(await screen.findByTestId('globe-inspector-panel')).toHaveTextContent('Site One')

    await act(async () => {
      globeEngineState.onSiteClick?.(null)
    })

    expect(await screen.findByTestId('location-search')).toBeEmptyDOMElement()
    expect(screen.queryByTestId('globe-inspector-panel')).not.toBeInTheDocument()
  })

  it('clears the selected asset route and inspector when the engine emits a deselect click', async () => {
    renderGlobePage('/globe')

    await act(async () => {
      globeEngineState.onAssetClick?.('asset-1')
    })

    expect(await screen.findByTestId('location-search')).toHaveTextContent('?asset_id=asset-1')
    expect(await screen.findByTestId('globe-inspector-panel')).toHaveTextContent('Asset One')

    await act(async () => {
      globeEngineState.onAssetClick?.(null)
    })

    expect(await screen.findByTestId('location-search')).toBeEmptyDOMElement()
    expect(screen.queryByTestId('globe-inspector-panel')).not.toBeInTheDocument()
  })

  it('clears the selected signal route and inspector when the engine emits a deselect click', async () => {
    mockState.signals = [
      {
        id: 'sig-1',
        signal_type: 'disaster_alert',
        source: 'gdacs',
        lat: 10,
        lng: 20,
        occurred_at: '2026-03-24T00:00:00Z',
        external_id: null,
        raw_payload: { name: 'Storm Warning' },
      },
    ]

    renderGlobePage('/globe')

    await act(async () => {
      globeEngineState.onSignalClick?.('sig-1')
    })

    expect(await screen.findByTestId('location-search')).toHaveTextContent('?signal_id=sig-1')
    expect(await screen.findByTestId('globe-inspector-panel')).toHaveTextContent('Storm Warning')

    await act(async () => {
      globeEngineState.onSignalClick?.(null)
    })

    expect(await screen.findByTestId('location-search')).toBeEmptyDOMElement()
    expect(screen.queryByTestId('globe-inspector-panel')).not.toBeInTheDocument()
  })

  it('clears a stale site selection and route when the backing site disappears after load', async () => {
    const view = renderGlobePage('/globe?site_id=site-1')

    expect(await screen.findByTestId('globe-inspector-panel')).toHaveTextContent('Site One')
    expect(screen.getByTestId('location-search')).toHaveTextContent('?site_id=site-1')

    mockState.sites = []
    view.rerender(view.renderTree())

    expect(await screen.findByTestId('location-search')).toBeEmptyDOMElement()
    expect(screen.queryByTestId('globe-inspector-panel')).not.toBeInTheDocument()
  })

  it('clears a stale asset selection and route when the backing asset disappears after load', async () => {
    const view = renderGlobePage('/globe?asset_id=asset-1')

    expect(await screen.findByTestId('globe-inspector-panel')).toHaveTextContent('Asset One')
    expect(screen.getByTestId('location-search')).toHaveTextContent('?asset_id=asset-1')

    mockState.assets = []
    view.rerender(view.renderTree())

    expect(await screen.findByTestId('location-search')).toBeEmptyDOMElement()
    expect(screen.queryByTestId('globe-inspector-panel')).not.toBeInTheDocument()
  })

  it('preserves a deep-linked signal route while SSE has not yet delivered the signal', async () => {
    vi.useFakeTimers()

    const view = renderGlobePage('/globe?signal_id=sig-1')

    expect(screen.getByTestId('location-search')).toHaveTextContent('?signal_id=sig-1')

    // SSE delivers the signal
    mockState.signals = [
      {
        id: 'sig-1',
        signal_type: 'disaster_alert',
        source: 'gdacs',
        lat: 10,
        lng: 20,
        occurred_at: '2026-03-24T00:00:00Z',
        external_id: null,
        raw_payload: { name: 'SSE delivered' },
      },
    ]
    await act(async () => {
      view.rerender(view.renderTree())
    })

    expect(screen.getByTestId('location-search')).toHaveTextContent('?signal_id=sig-1')
    expect(screen.getByTestId('globe-inspector-panel')).toBeInTheDocument()
  })

  it('clears a deep-linked signal route after the SSE grace period expires with no delivery', async () => {
    vi.useFakeTimers()

    renderGlobePage('/globe?signal_id=sig-never')

    expect(screen.getByTestId('location-search')).toHaveTextContent('?signal_id=sig-never')

    await act(async () => {
      vi.advanceTimersByTime(1500)
    })

    expect(screen.getByTestId('location-search')).toBeEmptyDOMElement()
  })

  it('clears a selected signal and route when the backing signal disappears after load', async () => {
    mockState.signals = [
      {
        id: 'sig-1',
        signal_type: 'disaster_alert',
        source: 'gdacs',
        lat: 10,
        lng: 20,
        occurred_at: '2026-03-24T00:00:00Z',
        external_id: null,
        raw_payload: { name: 'Storm Warning' },
      },
    ]

    const view = renderGlobePage('/globe?signal_id=sig-1')

    expect(await screen.findByTestId('globe-inspector-panel')).toHaveTextContent('Storm Warning')
    expect(screen.getByTestId('location-search')).toHaveTextContent('?signal_id=sig-1')

    mockState.signals = []
    view.rerender(view.renderTree())

    expect(await screen.findByTestId('location-search')).toBeEmptyDOMElement()
    expect(screen.queryByTestId('globe-inspector-panel')).not.toBeInTheDocument()
  })

  it('gives an external same-signal retry a fresh SSE grace window in a long-lived session', async () => {
    // Mirror of the MapPage regression guard — this must prove the external
    // same-signal retry path, not the self-authored engine callback path.
    vi.useFakeTimers()

    // Phase 1 — settle the grace window for sig-a.
    renderGlobePage('/globe?signal_id=sig-a')
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(screen.getByTestId('location-search')).toBeEmptyDOMElement()

    // Phase 2 — retry the SAME signal through the router. This keeps the route
    // authoritative and directly proves the location.key-scoped grace window.
    expect(routerState.navigate).not.toBeNull()
    await act(async () => {
      routerState.navigate?.('/globe?signal_id=sig-a')
    })

    expect(screen.getByTestId('location-search')).toHaveTextContent('?signal_id=sig-a')
  })
})
