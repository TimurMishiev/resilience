import { useEffect } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
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
    external_id: string | null
    raw_payload: Record<string, unknown>
  }>,
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

const vesselHookState = vi.hoisted(() => ({
  useVessels: vi.fn(),
  useVesselTracks: vi.fn(),
}))

vi.mock('../hooks/useSites', () => ({
  useSites: () => ({
    data: { data: mockState.sites },
    isLoading: false,
    isSuccess: true,
    error: null,
  }),
  useAllSites: () => ({
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
  useAllTasks: () => ({
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
  useAllAssets: () => ({
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
  useAllAreasOfOperation: () => ({
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
  useVessels: (...args: unknown[]) => vesselHookState.useVessels(...args),
  useVesselTracks: (...args: unknown[]) => vesselHookState.useVesselTracks(...args),
}))

vi.mock('../hooks/useSignalRuleMatches', () => ({
  useActiveBreachSiteIds: () => ({
    data: { site_ids: ['site-1'] },
  }),
}))

vi.mock('../hooks/useReplayParams', () => ({
  useReplayParams: () => mockReplay,
}))

vi.mock('../lib/perfInstrumentation', () => ({
  isPerfEnabled: () => window.localStorage.getItem('resilience.perf') === '1',
}))

const globeEngineState = vi.hoisted(() => ({
  onSiteClick: null as ((siteId: string | null) => void) | null,
  onAssetClick: null as ((assetId: string | null) => void) | null,
  onSignalClick: null as ((signalId: string | null) => void) | null,
  latestInput: null as null | {
    showHeatmap: boolean
    showChokepoints: boolean
    chokepoints: Array<{ id: string }>
    breachedSiteIds: Set<string>
  },
}))

const routerState = vi.hoisted(() => ({
  navigate: null as null | ((to: string) => void),
}))

vi.mock('../hooks/useGlobeEngine', () => ({
  useGlobeEngine: (input: {
    onSiteClick?: (siteId: string | null) => void
    onAssetClick?: (assetId: string | null) => void
    onSignalClick?: (signalId: string | null) => void
    showHeatmap?: boolean
    showChokepoints?: boolean
    chokepoints?: Array<{ id: string }>
    breachedSiteIds?: Set<string>
  }) => {
    globeEngineState.onSiteClick = input.onSiteClick ?? null
    globeEngineState.onAssetClick = input.onAssetClick ?? null
    globeEngineState.onSignalClick = input.onSignalClick ?? null
    globeEngineState.latestInput = {
      showHeatmap: input.showHeatmap ?? false,
      showChokepoints: input.showChokepoints ?? false,
      chokepoints: input.chokepoints ?? [],
      breachedSiteIds: input.breachedSiteIds ?? new Set(),
    }
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
  GlobeInspectorPanel: ({ inspectorTitle, selectedVessel }: { inspectorTitle: string; selectedVessel?: { mmsi?: string | null } | null }) => (
    <div data-testid="globe-inspector-panel">
      <span>{inspectorTitle}</span>
      {selectedVessel?.mmsi ? <span data-testid="globe-vessel-mmsi">{selectedVessel.mmsi}</span> : null}
    </div>
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
    globeEngineState.latestInput = null
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
    vesselHookState.useVessels.mockReset()
    vesselHookState.useVesselTracks.mockReset()
    vesselHookState.useVessels.mockReturnValue({ data: { data: [] } })
    vesselHookState.useVesselTracks.mockReturnValue({ data: { data: [] } })
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

  it('toggles the chokepoint overlay through globe page state', async () => {
    renderGlobePage('/globe')

    const chokepointToggle = screen.getByText('CHOKEPOINTS ON')

    expect(screen.getByText('Monitor')).toBeInTheDocument()
    expect(globeEngineState.latestInput?.showChokepoints).toBe(true)
    expect(globeEngineState.latestInput?.chokepoints).toHaveLength(1)

    await act(async () => {
      chokepointToggle.click()
    })

    expect(screen.getByText('CHOKEPOINTS OFF')).toBeInTheDocument()
    expect(screen.queryByText('Monitor')).not.toBeInTheDocument()
    expect(globeEngineState.latestInput?.showChokepoints).toBe(false)
  })

  it('toggles the heatmap overlay through globe page state', async () => {
    renderGlobePage('/globe')

    const heatmapToggle = screen.getByText('HEATMAP OFF')

    expect(screen.queryByText('LOW DENSITY')).not.toBeInTheDocument()
    expect(globeEngineState.latestInput?.showHeatmap).toBe(false)

    await act(async () => {
      heatmapToggle.click()
    })

    expect(screen.getByText('HEATMAP ON')).toBeInTheDocument()
    expect(screen.getByText('LOW DENSITY')).toBeInTheDocument()
    expect(screen.getByText('HIGH DENSITY')).toBeInTheDocument()
    expect(globeEngineState.latestInput?.showHeatmap).toBe(true)
  })

  it('supports keyboard toggling for globe toolbar controls', async () => {
    renderGlobePage('/globe')

    const heatmapToggle = screen.getByRole('button', { name: 'HEATMAP OFF' })

    expect(heatmapToggle).toHaveAttribute('aria-pressed', 'false')

    await act(async () => {
      fireEvent.keyDown(heatmapToggle, { key: 'Enter' })
    })

    expect(screen.getByRole('button', { name: 'HEATMAP ON' })).toHaveAttribute('aria-pressed', 'true')
    expect(globeEngineState.latestInput?.showHeatmap).toBe(true)
  })

  it('hides chokepoint controls and clears chokepoint data during replay', async () => {
    mockReplay.asOf = '2026-03-24T12:00'
    mockReplay.isReplaying = true
    mockReplay.asOfParam = { as_of: mockReplay.asOf }
    mockReplay.signalQueryParams = { as_of: mockReplay.asOf }

    renderGlobePage('/globe')

    expect(screen.getByText(/CHOKEPOINTS (ON|OFF)/)).toBeInTheDocument()
    expect(screen.getByText('Monitor')).toBeInTheDocument()
    expect(globeEngineState.latestInput?.chokepoints).toHaveLength(1)
    expect(globeEngineState.latestInput?.breachedSiteIds.has('site-1')).toBe(true)
    expect(screen.getByText(/Replay mode keeps historical AO overlays, chokepoint overlays, breach overlays, and AIS vessel context visible/i)).toHaveTextContent('Live-only vessel enrichments remain limited')
  })

  it('keeps selected-vessel trail queries replay-aware', () => {
    mockReplay.asOf = '2026-03-29T10:00:00.000Z'
    mockReplay.isReplaying = true
    mockReplay.asOfParam = { as_of: mockReplay.asOf }
    mockReplay.signalQueryParams = { to: mockReplay.asOf }
    mockState.signals = [
      {
        id: 'sig-vessel',
        signal_type: 'vessel_position',
        source: 'ais',
        lat: 10,
        lng: 20,
        occurred_at: '2026-03-29T09:55:00.000Z',
        external_id: '111000001',
        raw_payload: {},
      },
    ]
    vesselHookState.useVessels.mockReturnValue({
      data: { data: [{ id: 'vessel-1', mmsi: '111000001', name: 'MV Alpha' }] },
    })

    renderGlobePage('/globe?signal_id=sig-vessel')

    expect(vesselHookState.useVessels).toHaveBeenCalledWith(
      { mmsi: '111000001', per_page: 1 },
      { enabled: true, refetchInterval: false },
    )
    expect(vesselHookState.useVesselTracks).toHaveBeenCalledWith(
      'vessel-1',
      { limit: 300, to: '2026-03-29T10:00:00.000Z' },
    )
    expect(screen.getByTestId('globe-vessel-mmsi')).toHaveTextContent('111000001')
  })

  it('keeps a stable globe benchmark bridge across live array replacement while exposing updated state', async () => {
    window.localStorage.setItem('resilience.perf', '1')

    const view = renderGlobePage('/globe')
    const bench = window.__resilienceGlobeBench

    expect(bench).toBeDefined()
    expect(bench?.getState().signalCount).toBe(0)
    expect(bench?.getBenchmarkTarget()).toBeNull()

    mockState.signals = [
      {
        id: 'sig-bench',
        signal_type: 'disaster_alert',
        source: 'gdacs',
        lat: 10,
        lng: 20,
        occurred_at: '2026-03-24T00:00:00Z',
        external_id: null,
        raw_payload: { name: 'Bench Signal' },
      },
    ]
    await act(async () => {
      view.rerender(view.renderTree())
    })

    expect(window.__resilienceGlobeBench).toBe(bench)
    expect(bench?.getState().signalCount).toBe(1)
    expect(bench?.getBenchmarkTarget()).not.toBeNull()
  })

  it('removes the benchmark bridge when perf mode is disabled after mount', async () => {
    window.localStorage.setItem('resilience.perf', '1')

    const view = renderGlobePage('/globe')
    expect(window.__resilienceGlobeBench).toBeDefined()

    window.localStorage.removeItem('resilience.perf')
    await act(async () => {
      view.rerender(view.renderTree())
    })

    expect(window.__resilienceGlobeBench).toBeUndefined()
  })
})
