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
  ] as Array<{
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

const engineState = vi.hoisted(() => ({
  flyTo: vi.fn(),
  resize: vi.fn(),
  latestInput: null as null | {
    showSignals: boolean
    showHeatmap: boolean
    showChokepoints: boolean
    annotationMode: boolean
    annotations: Array<{ id: string; label: string }>
    rangeRingMode: boolean
    sectorMode: boolean
    bearingLineMode: boolean
    measurementMode: boolean
    chokepoints: Array<{ id: string }>
    breachedSiteIds: Set<string>
    onSiteClick: (siteId: string | null) => void
    onAssetClick: (assetId: string | null) => void
    onSignalClick: (signalId: string | null) => void
    onMapAnnotationClick: (point: { lng: number; lat: number }) => void
    onMapRangeRingAnchorClick: (point: { lng: number; lat: number }) => void
    onMapSectorAnchorClick: (point: { lng: number; lat: number }) => void
    onMapBearingLineAnchorClick: (point: { lng: number; lat: number }) => void
    onMapCoordinateClick: (point: { lng: number; lat: number }) => void
  },
}))

const routerState = vi.hoisted(() => ({
  navigate: null as null | ((to: string) => void),
}))

const evidenceLinkedIdsState = vi.hoisted(() => ({
  useEvidenceLinkedIds: vi.fn(),
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

vi.mock('../hooks/useRiskScores', () => ({
  useRiskScores: () => ({
    data: [],
  }),
}))

vi.mock('../hooks/useSignalRuleMatches', () => ({
  useActiveBreachSiteIds: () => ({
    data: { site_ids: ['site-1'] },
  }),
  useSignalRuleMatches: () => ({ data: null }),
}))

vi.mock('../hooks/useEvidenceLinkedIds', () => ({
  useEvidenceLinkedIds: (...args: unknown[]) => evidenceLinkedIdsState.useEvidenceLinkedIds(...args),
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => ({
    role: 'commander',
    canTriageAlerts: true,
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
    annotationMode: boolean
    annotations: Array<{ id: string; label: string }>
    rangeRingMode: boolean
    sectorMode: boolean
    bearingLineMode: boolean
    measurementMode: boolean
    chokepoints: Array<{ id: string }>
    breachedSiteIds: Set<string>
    onSiteClick: (siteId: string | null) => void
    onAssetClick: (assetId: string | null) => void
    onSignalClick: (signalId: string | null) => void
    onMapAnnotationClick: (point: { lng: number; lat: number }) => void
    onMapRangeRingAnchorClick: (point: { lng: number; lat: number }) => void
    onMapSectorAnchorClick: (point: { lng: number; lat: number }) => void
    onMapBearingLineAnchorClick: (point: { lng: number; lat: number }) => void
    onMapCoordinateClick: (point: { lng: number; lat: number }) => void
  }) => {
    engineState.latestInput = input
    return {
      mapLoaded: true,
      flyTo: engineState.flyTo,
      getZoom: vi.fn(() => 1.5),
      projectPosition: vi.fn(),
      inspectCanvasPosition: vi.fn(() => null),
      resize: engineState.resize,
    }
  },
}))

vi.mock('../components/MapSitePanel', () => ({
  MapSitePanel: ({
    site,
    onSelectSignal,
  }: {
    site: { name: string }
    onSelectSignal?: (signalId: string) => void
  }) => (
    <div data-testid="map-site-panel">
      <span>{site.name}</span>
      <button type="button" data-testid="map-site-open-signal" onClick={() => onSelectSignal?.('sig-1')}>
        Inspect signal
      </button>
    </div>
  ),
}))

vi.mock('../components/MapAssetPanel', () => ({
  MapAssetPanel: ({
    asset,
    onSelectHomeSite,
    onSelectSignal,
  }: {
    asset: { name: string; home_site_id?: string | null }
    onSelectHomeSite?: (siteId: string) => void
    onSelectSignal?: (signalId: string) => void
  }) => (
    <div data-testid="map-asset-panel">
      <span>{asset.name}</span>
      {asset.home_site_id ? (
        <>
          <button type="button" data-testid="map-asset-open-site" onClick={() => onSelectHomeSite?.(asset.home_site_id!)}>
            Inspect home site
          </button>
          <button type="button" data-testid="map-asset-open-signal" onClick={() => onSelectSignal?.('sig-1')}>
            Inspect signal
          </button>
        </>
      ) : null}
    </div>
  ),
}))

vi.mock('../components/MapSignalPanel', () => ({
  MapSignalPanel: ({
    signal,
    vessel,
    onSelectSite,
  }: {
    signal: { raw_payload: { version: string } }
    vessel?: { mmsi?: string | null } | null
    onSelectSite?: (siteId: string) => void
  }) => (
    <div data-testid="map-signal-panel">
      <span data-testid="signal-version">{signal.raw_payload.version}</span>
      {vessel?.mmsi ? <span data-testid="signal-vessel-mmsi">{vessel.mmsi}</span> : null}
      <button type="button" data-testid="map-signal-open-site" onClick={() => onSelectSite?.('site-1')}>
        Inspect site
      </button>
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
    vesselHookState.useVessels.mockReset()
    vesselHookState.useVesselTracks.mockReset()
    evidenceLinkedIdsState.useEvidenceLinkedIds.mockReset()
    vesselHookState.useVessels.mockReturnValue({ data: { data: [] } })
    vesselHookState.useVesselTracks.mockReturnValue({ data: { data: [] } })
    evidenceLinkedIdsState.useEvidenceLinkedIds.mockReturnValue({ evidenceSignalIds: [], evidenceSiteIds: [] })
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

  it('switches from site alert context into the related signal panel without leaving /map', async () => {
    renderMapPage('/map?site_id=site-1')

    expect(await screen.findByTestId('map-site-panel')).toHaveTextContent('Site One')

    await act(async () => {
      screen.getByTestId('map-site-open-signal').click()
    })

    expect(await screen.findByTestId('map-signal-panel')).toBeInTheDocument()
    expect(screen.getByTestId('location-search')).toHaveTextContent('?signal_id=sig-1')
    expect(screen.queryByTestId('map-site-panel')).not.toBeInTheDocument()
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

  it('switches from asset context into the related site panel without leaving /map', async () => {
    renderMapPage('/map?asset_id=asset-1')

    expect(await screen.findByTestId('map-asset-panel')).toHaveTextContent('Asset One')

    await act(async () => {
      screen.getByTestId('map-asset-open-site').click()
    })

    expect(await screen.findByTestId('map-site-panel')).toHaveTextContent('Site One')
    expect(screen.getByTestId('location-search')).toHaveTextContent('?site_id=site-1')
    expect(screen.queryByTestId('map-asset-panel')).not.toBeInTheDocument()
  })

  it('switches from asset site-alert context into the related signal panel without leaving /map', async () => {
    renderMapPage('/map?asset_id=asset-1')

    expect(await screen.findByTestId('map-asset-panel')).toHaveTextContent('Asset One')

    await act(async () => {
      screen.getByTestId('map-asset-open-signal').click()
    })

    expect(await screen.findByTestId('map-signal-panel')).toBeInTheDocument()
    expect(screen.getByTestId('location-search')).toHaveTextContent('?signal_id=sig-1')
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

  it('switches from signal context into the related site panel without leaving /map', async () => {
    renderMapPage('/map?signal_id=sig-1')

    expect(await screen.findByTestId('map-signal-panel')).toBeInTheDocument()

    await act(async () => {
      screen.getByTestId('map-signal-open-site').click()
    })

    expect(await screen.findByTestId('map-site-panel')).toHaveTextContent('Site One')
    expect(screen.getByTestId('location-search')).toHaveTextContent('?site_id=site-1')
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

    expect(screen.getByRole('button', { name: 'Toggle chokepoint overlay' })).toBeInTheDocument()
    expect(screen.getByText('Monitor')).toBeInTheDocument()
    expect(engineState.latestInput?.chokepoints).toHaveLength(1)
    expect(engineState.latestInput?.breachedSiteIds.has('site-1')).toBe(true)
    expect(screen.getByText(/Historical AO overlays, risk shading, chokepoint overlays, geofence breach rings, and AIS vessel context remain available during replay/i)).toBeInTheDocument()
  })

  it('passes replay as_of into evidence-linked highlighting queries', async () => {
    mockReplay.asOf = '2026-03-24T12:00:00.000Z'
    mockReplay.isReplaying = true
    mockReplay.asOfParam = { as_of: mockReplay.asOf }
    mockReplay.signalQueryParams = { to: mockReplay.asOf, as_of: mockReplay.asOf }

    renderMapPage('/map?site_id=site-1')

    expect(await screen.findByTestId('map-site-panel')).toHaveTextContent('Site One')
    expect(evidenceLinkedIdsState.useEvidenceLinkedIds).toHaveBeenLastCalledWith(
      'site-1',
      null,
      '2026-03-24T12:00:00.000Z',
    )
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
        raw_payload: { version: 'v1' },
      },
    ]
    vesselHookState.useVessels.mockReturnValue({
      data: { data: [{ id: 'vessel-1', mmsi: '111000001', name: 'MV Alpha' }] },
    })

    renderMapPage('/map?signal_id=sig-vessel')

    expect(vesselHookState.useVessels).toHaveBeenCalledWith(
      { mmsi: '111000001', per_page: 1 },
      { enabled: true, refetchInterval: false },
    )
    expect(vesselHookState.useVesselTracks).toHaveBeenCalledWith(
      'vessel-1',
      { limit: 300, to: '2026-03-29T10:00:00.000Z' },
    )
    expect(screen.getByTestId('signal-vessel-mmsi')).toHaveTextContent('111000001')
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

  it('docks the context panel when a site is selected and resizes the map', async () => {
    renderMapPage('/map')

    expect(screen.queryByRole('complementary', { name: 'Map selection detail' })).toBeNull()
    engineState.resize.mockClear()

    await act(async () => {
      engineState.latestInput?.onSiteClick('site-1')
    })

    const panel = await screen.findByRole('complementary', { name: 'Map selection detail' })
    expect(panel).toBeInTheDocument()
    expect(panel.closest('.map-page')).toHaveClass('map-page--panel-open')

    await act(async () => {
      await new Promise(resolve => requestAnimationFrame(() => resolve(null)))
    })
    expect(engineState.resize).toHaveBeenCalled()
  })

  it('closes the docked panel and clears selection when Escape is pressed', async () => {
    renderMapPage('/map?site_id=site-1')

    expect(await screen.findByRole('complementary', { name: 'Map selection detail' })).toBeInTheDocument()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(screen.queryByRole('complementary', { name: 'Map selection detail' })).toBeNull()
    expect(screen.getByTestId('location-search')).not.toHaveTextContent('site_id=site-1')
  })

  it('opens the panel in empty state when ] is pressed with no selection', async () => {
    renderMapPage('/map')

    expect(screen.queryByRole('complementary', { name: 'Map selection detail' })).toBeNull()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']' }))
    })

    const panel = await screen.findByRole('complementary', { name: 'Map selection detail' })
    expect(panel).toBeInTheDocument()
    expect(screen.getByTestId('panel-empty-state')).toHaveTextContent('Select a site, asset, or signal')
  })

  it('closes the force-opened panel when ] is pressed again', async () => {
    renderMapPage('/map')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']' }))
    })

    expect(screen.getByRole('complementary', { name: 'Map selection detail' })).toBeInTheDocument()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']' }))
    })

    expect(screen.queryByRole('complementary', { name: 'Map selection detail' })).toBeNull()
  })

  it('closes a selection-opened panel and clears selection when ] is pressed', async () => {
    renderMapPage('/map?site_id=site-1')

    expect(await screen.findByTestId('map-site-panel')).toBeInTheDocument()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']' }))
    })

    expect(screen.queryByRole('complementary', { name: 'Map selection detail' })).toBeNull()
    expect(screen.getByTestId('location-search')).not.toHaveTextContent('site_id=site-1')
  })

  it('renders the resize handle inside the docked panel', async () => {
    renderMapPage('/map?site_id=site-1')

    expect(await screen.findByRole('complementary', { name: 'Map selection detail' })).toBeInTheDocument()
    expect(screen.getByTestId('panel-resize-handle')).toBeInTheDocument()
  })

  it('captures and clears a session-local map measurement without changing route selection', async () => {
    renderMapPage('/map')

    expect(screen.queryByTestId('map-measure-panel')).toBeNull()
    expect(engineState.latestInput?.measurementMode).toBe(false)

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle map measurement tool' }).click()
    })

    expect(await screen.findByTestId('map-measure-panel')).toHaveTextContent('Click an anchor point on the map')
    expect(engineState.latestInput?.measurementMode).toBe(true)

    await act(async () => {
      engineState.latestInput?.onMapCoordinateClick({ lat: 37.7749, lng: -122.4194 })
    })

    expect(screen.getByTestId('map-measure-panel')).toHaveTextContent('37.7749, -122.4194')
    expect(screen.getByTestId('location-search')).toBeEmptyDOMElement()

    await act(async () => {
      engineState.latestInput?.onMapCoordinateClick({ lat: 34.0522, lng: -118.2437 })
    })

    expect(screen.getByTestId('map-measure-panel')).toHaveTextContent('Distance')
    expect(screen.getByTestId('map-measure-panel')).toHaveTextContent('Bearing')

    await act(async () => {
      screen.getByRole('button', { name: 'Clear' }).click()
    })

    expect(screen.getByTestId('map-measure-panel')).toHaveTextContent('Click an anchor point on the map')
    expect(screen.queryByText('Distance')).not.toBeInTheDocument()
  })

  it('captures and manages session-local annotations without changing route selection', async () => {
    renderMapPage('/map')

    expect(screen.queryByTestId('map-annotate-panel')).toBeNull()
    expect(engineState.latestInput?.annotationMode).toBe(false)

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle map annotation tool' }).click()
    })

    expect(await screen.findByTestId('map-annotate-panel')).toHaveTextContent('No temporary annotations yet.')
    expect(engineState.latestInput?.annotationMode).toBe(true)

    await act(async () => {
      engineState.latestInput?.onMapAnnotationClick({ lat: 37.7749, lng: -122.4194 })
      engineState.latestInput?.onMapAnnotationClick({ lat: 34.0522, lng: -118.2437 })
    })

    expect(screen.getByDisplayValue('Mark 1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Mark 2')).toBeInTheDocument()
    expect(screen.getByTestId('location-search')).toBeEmptyDOMElement()

    fireEvent.change(screen.getByDisplayValue('Mark 1'), {
      target: { value: 'Ingress point' },
    })

    expect(screen.getByDisplayValue('Ingress point')).toBeInTheDocument()

    await act(async () => {
      screen.getAllByRole('button', { name: 'Remove' })[1]?.click()
    })

    expect(screen.queryByDisplayValue('Mark 2')).not.toBeInTheDocument()

    await act(async () => {
      screen.getByRole('button', { name: 'Clear all' }).click()
    })

    expect(screen.getByTestId('map-annotate-panel')).toHaveTextContent('No temporary annotations yet.')

    await act(async () => {
      engineState.latestInput?.onMapAnnotationClick({ lat: 40.7128, lng: -74.006 })
    })

    expect(screen.getByDisplayValue('Mark 1')).toBeInTheDocument()
  })

  it('captures and manages session-local range rings without changing route selection', async () => {
    renderMapPage('/map')

    expect(screen.queryByTestId('map-range-panel')).toBeNull()
    expect(engineState.latestInput?.rangeRingMode).toBe(false)

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle map range ring tool' }).click()
    })

    expect(await screen.findByTestId('map-range-panel')).toHaveTextContent('No range anchor yet.')
    expect(engineState.latestInput?.rangeRingMode).toBe(true)

    await act(async () => {
      engineState.latestInput?.onMapRangeRingAnchorClick({ lat: 37.7749, lng: -122.4194 })
    })

    expect(screen.getByTestId('map-range-panel')).toHaveTextContent('37.7749, -122.4194')
    expect(screen.getByRole('spinbutton', { name: 'Range ring 1 radius' })).toHaveValue(5)
    expect(screen.getByTestId('location-search')).toBeEmptyDOMElement()

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Range ring 1 radius' }), {
      target: { value: '8' },
    })

    expect(screen.getByRole('spinbutton', { name: 'Range ring 1 radius' })).toHaveValue(8)

    await act(async () => {
      screen.getByRole('button', { name: 'Clear' }).click()
    })

    expect(screen.getByTestId('map-range-panel')).toHaveTextContent('No range anchor yet.')
  })

  it('captures and manages a session-local bearing line without changing route selection', async () => {
    renderMapPage('/map')

    expect(screen.queryByTestId('map-bearing-panel')).toBeNull()
    expect(engineState.latestInput?.bearingLineMode).toBe(false)

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle map bearing line tool' }).click()
    })

    expect(await screen.findByTestId('map-bearing-panel')).toHaveTextContent('No bearing anchor yet.')
    expect(engineState.latestInput?.bearingLineMode).toBe(true)

    await act(async () => {
      engineState.latestInput?.onMapBearingLineAnchorClick({ lat: 37.7749, lng: -122.4194 })
    })

    expect(screen.getByTestId('map-bearing-panel')).toHaveTextContent('37.7749, -122.4194')
    expect(screen.getByRole('spinbutton', { name: 'Bearing degrees' })).toHaveValue(45)
    expect(screen.getByRole('spinbutton', { name: 'Bearing line extent' })).toHaveValue(20)
    expect(screen.getByTestId('location-search')).toBeEmptyDOMElement()

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Bearing degrees' }), {
      target: { value: '120' },
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Bearing line extent' }), {
      target: { value: '12' },
    })

    expect(screen.getByTestId('map-bearing-panel')).toHaveTextContent('120°')
    expect(screen.getByTestId('map-bearing-panel')).toHaveTextContent('12 NM')

    await act(async () => {
      screen.getByRole('button', { name: 'Clear' }).click()
    })

    expect(screen.getByTestId('map-bearing-panel')).toHaveTextContent('No bearing anchor yet.')
  })

  it('captures and manages a session-local sector overlay without changing route selection', async () => {
    renderMapPage('/map')

    expect(screen.queryByTestId('map-sector-panel')).toBeNull()
    expect(engineState.latestInput?.sectorMode).toBe(false)

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle map sector tool' }).click()
    })

    expect(await screen.findByTestId('map-sector-panel')).toHaveTextContent('No sector anchor yet.')
    expect(engineState.latestInput?.sectorMode).toBe(true)

    await act(async () => {
      engineState.latestInput?.onMapSectorAnchorClick({ lat: 37.7749, lng: -122.4194 })
    })

    expect(screen.getByTestId('map-sector-panel')).toHaveTextContent('37.7749, -122.4194')
    expect(screen.getByRole('spinbutton', { name: 'Sector bearing degrees' })).toHaveValue(45)
    expect(screen.getByRole('spinbutton', { name: 'Sector arc degrees' })).toHaveValue(60)
    expect(screen.getByRole('spinbutton', { name: 'Sector extent' })).toHaveValue(20)
    expect(screen.getByTestId('location-search')).toBeEmptyDOMElement()

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Sector bearing degrees' }), {
      target: { value: '120' },
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Sector arc degrees' }), {
      target: { value: '90' },
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Sector extent' }), {
      target: { value: '12' },
    })

    expect(screen.getByTestId('map-sector-panel')).toHaveTextContent('120°')
    expect(screen.getByTestId('map-sector-panel')).toHaveTextContent('90° ARC')
    expect(screen.getByTestId('map-sector-panel')).toHaveTextContent('12 NM')

    await act(async () => {
      screen.getByRole('button', { name: 'Clear' }).click()
    })

    expect(screen.getByTestId('map-sector-panel')).toHaveTextContent('No sector anchor yet.')
  })

  it('keeps annotation, range-ring, sector, bearing-line, and measurement modes mutually exclusive', async () => {
    renderMapPage('/map')

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle map annotation tool' }).click()
    })

    expect(await screen.findByTestId('map-annotate-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('map-measure-panel')).toBeNull()

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle map range ring tool' }).click()
    })

    expect(await screen.findByTestId('map-range-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('map-annotate-panel')).toBeNull()
    expect(screen.queryByTestId('map-measure-panel')).toBeNull()

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle map sector tool' }).click()
    })

    expect(await screen.findByTestId('map-sector-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('map-annotate-panel')).toBeNull()
    expect(screen.queryByTestId('map-range-panel')).toBeNull()
    expect(screen.queryByTestId('map-measure-panel')).toBeNull()

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle map bearing line tool' }).click()
    })

    expect(await screen.findByTestId('map-bearing-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('map-annotate-panel')).toBeNull()
    expect(screen.queryByTestId('map-range-panel')).toBeNull()
    expect(screen.queryByTestId('map-sector-panel')).toBeNull()
    expect(screen.queryByTestId('map-measure-panel')).toBeNull()

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle map measurement tool' }).click()
    })

    expect(await screen.findByTestId('map-measure-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('map-annotate-panel')).toBeNull()
    expect(screen.queryByTestId('map-range-panel')).toBeNull()
    expect(screen.queryByTestId('map-sector-panel')).toBeNull()
    expect(screen.queryByTestId('map-bearing-panel')).toBeNull()

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle map annotation tool' }).click()
    })

    expect(await screen.findByTestId('map-annotate-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('map-measure-panel')).toBeNull()
  })

  it('turns range-ring mode off on Escape before closing the docked panel', async () => {
    renderMapPage('/map?site_id=site-1')

    expect(await screen.findByRole('complementary', { name: 'Map selection detail' })).toBeInTheDocument()

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle map range ring tool' }).click()
    })

    expect(await screen.findByTestId('map-range-panel')).toBeInTheDocument()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(screen.queryByTestId('map-range-panel')).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Map selection detail' })).toBeInTheDocument()
  })

  it('turns sector mode off on Escape before closing the docked panel', async () => {
    renderMapPage('/map?site_id=site-1')

    expect(await screen.findByRole('complementary', { name: 'Map selection detail' })).toBeInTheDocument()

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle map sector tool' }).click()
    })

    expect(await screen.findByTestId('map-sector-panel')).toBeInTheDocument()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(screen.queryByTestId('map-sector-panel')).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Map selection detail' })).toBeInTheDocument()
  })

  it('turns bearing-line mode off on Escape before closing the docked panel', async () => {
    renderMapPage('/map?site_id=site-1')

    expect(await screen.findByRole('complementary', { name: 'Map selection detail' })).toBeInTheDocument()

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle map bearing line tool' }).click()
    })

    expect(await screen.findByTestId('map-bearing-panel')).toBeInTheDocument()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(screen.queryByTestId('map-bearing-panel')).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Map selection detail' })).toBeInTheDocument()
  })

  it('turns annotation mode off on Escape before closing the docked panel', async () => {
    renderMapPage('/map?site_id=site-1')

    expect(await screen.findByRole('complementary', { name: 'Map selection detail' })).toBeInTheDocument()

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle map annotation tool' }).click()
    })

    expect(await screen.findByTestId('map-annotate-panel')).toBeInTheDocument()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(screen.queryByTestId('map-annotate-panel')).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Map selection detail' })).toBeInTheDocument()
  })

  it('turns measurement mode off on Escape before closing the docked panel', async () => {
    renderMapPage('/map?site_id=site-1')

    expect(await screen.findByRole('complementary', { name: 'Map selection detail' })).toBeInTheDocument()

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle map measurement tool' }).click()
    })

    expect(await screen.findByTestId('map-measure-panel')).toBeInTheDocument()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(screen.queryByTestId('map-measure-panel')).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Map selection detail' })).toBeInTheDocument()
  })
})
