import { test, expect, type Page } from '@playwright/test'
import { enableE2EBridge, primeAuthenticatedSession } from './helpers'

type MapSelectionTarget = {
  id: string
  name: string
}

type CanvasPoint = {
  x: number
  y: number
}

type SiteFixture = {
  id: string
  name: string
  latitude: number
  longitude: number
  status: string
  geofence_radius_km: number
}

type SignalFixture = {
  id: string
  source: string
  signal_type: string
  external_id: string
  lat: number
  lng: number
  occurred_at: string
  ingested_at: string
  raw_payload: Record<string, unknown>
  magnitude?: number | null
  altitude?: number | null
  speed?: number | null
  heading?: number | null
}

type StubbedMapRoutes = {
  waitForSignalBaseline: (signalType: string) => Promise<void>
}

const EMPTY_SSE_RESPONSE = {
  status: 200,
  headers: { 'content-type': 'text/event-stream' },
  body: '',
}

const CONNECTED_SSE_RESPONSE = {
  status: 200,
  headers: { 'content-type': 'text/event-stream' },
  body: 'event: connected\ndata: {}\n\n',
}

function emptyPaginatedResponse() {
  return {
    data: [],
    meta: { page: 1, total_pages: 1, per_page: 0, total: 0 },
  }
}

test.use({ serviceWorkers: 'block' })

async function mockStableSignalStream(page: Page) {
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource

    class StableSignalEventSource {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSED = 2

      CONNECTING = 0
      OPEN = 1
      CLOSED = 2

      url: string
      withCredentials: boolean
      readyState: number
      onerror: ((this: EventSource, ev: Event) => unknown) | null
      onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null
      onopen: ((this: EventSource, ev: Event) => unknown) | null
      privateClosed = false
      privateTarget: EventTarget | null
      privateDelegate: EventSource | null

      constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        const href = String(url)
        this.url = href
        this.withCredentials = Boolean(eventSourceInitDict?.withCredentials)
        this.onerror = null
        this.onmessage = null
        this.onopen = null
        this.privateTarget = null
        this.privateDelegate = null

        if (!href.includes('/api/signals/stream')) {
          this.privateDelegate = new NativeEventSource(url, eventSourceInitDict)
          this.readyState = this.privateDelegate.readyState
          return
        }

        this.privateTarget = new EventTarget()
        this.readyState = StableSignalEventSource.OPEN

        queueMicrotask(() => {
          if (this.privateClosed) return
          this.dispatchEvent(new MessageEvent('connected', { data: '{}' }))
        })
      }

      close() {
        this.privateClosed = true
        if (this.privateDelegate) {
          this.privateDelegate.close()
          this.readyState = this.privateDelegate.readyState
          return
        }
        this.readyState = StableSignalEventSource.CLOSED
      }

      addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
        if (this.privateDelegate) {
          this.privateDelegate.addEventListener(type, listener, options)
          return
        }
        this.privateTarget?.addEventListener(type, listener, options)
      }

      removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
        if (this.privateDelegate) {
          this.privateDelegate.removeEventListener(type, listener, options)
          return
        }
        this.privateTarget?.removeEventListener(type, listener, options)
      }

      dispatchEvent(event: Event): boolean {
        if (this.privateDelegate) {
          return this.privateDelegate.dispatchEvent(event)
        }
        return this.privateTarget?.dispatchEvent(event) ?? true
      }
    }

    Object.defineProperty(window, 'EventSource', {
      configurable: true,
      writable: true,
      value: StableSignalEventSource,
    })
  })
}

async function stubMapPageRoutes(
  page: Page,
  {
    sites,
    signals = [],
  }: {
    sites: SiteFixture[]
    signals?: SignalFixture[]
  },
): Promise<StubbedMapRoutes> {
  const fulfilledSignalTypes = new Set<string>()
  const signalBaselineWaiters = new Map<string, Array<() => void>>()

  const markSignalBaselineFulfilled = (signalType: string | null) => {
    if (!signalType) return
    fulfilledSignalTypes.add(signalType)
    const waiters = signalBaselineWaiters.get(signalType)
    if (!waiters) return
    signalBaselineWaiters.delete(signalType)
    for (const resolve of waiters) resolve()
  }

  await page.route('**/api/sse_token', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'e2e-sse-token', expires_in: 60 }),
    })
  })
  await page.route('**/api/sites**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: sites,
        meta: { page: 1, total_pages: 1, per_page: sites.length, total: sites.length },
      }),
    })
  })
  await page.route('**/api/tasks**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyPaginatedResponse()),
    })
  })
  await page.route('**/api/assets**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyPaginatedResponse()),
    })
  })
  await page.route('**/api/areas_of_operation**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyPaginatedResponse()),
    })
  })
  await page.route('**/api/risk_scores**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })
  await page.route('**/api/signal_rule_matches/active_breach_sites**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ site_ids: [] }),
    })
  })
  await page.route('**/api/signals/stream**', async route => {
    await route.fulfill(CONNECTED_SSE_RESPONSE)
  })
  await page.route('**/api/signals**', async route => {
    const signalType = new URL(route.request().url()).searchParams.get('signal_type')
    const matchingSignals = signalType ? signals.filter(signal => signal.signal_type === signalType) : signals

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: matchingSignals,
        meta: { page: 1, total_pages: 1, total_count: matchingSignals.length },
      }),
    })

    markSignalBaselineFulfilled(signalType)
  })
  await page.route('**/api/events**', async route => {
    await route.fulfill(EMPTY_SSE_RESPONSE)
  })
  await page.route('**/api/telemetry/stream**', async route => {
    await route.fulfill(EMPTY_SSE_RESPONSE)
  })

  return {
    waitForSignalBaseline: (signalType: string) => {
      if (fulfilledSignalTypes.has(signalType)) return Promise.resolve()

      return new Promise<void>(resolve => {
        const waiters = signalBaselineWaiters.get(signalType) ?? []
        waiters.push(resolve)
        signalBaselineWaiters.set(signalType, waiters)
      })
    },
  }
}

async function waitForMapBridge(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/map')
    await expect(page).toHaveURL(/\/map(?:\?.*)?$/)

    try {
      await page.locator('.shell-main').waitFor({ state: 'visible', timeout: 15_000 })
      await page.locator('.map-container').waitFor({ state: 'visible', timeout: 15_000 })
      await page.locator('.maplibregl-canvas').waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForFunction(() =>
        Boolean((window as Window & {
          __resilienceMapE2E?: { getState: () => { mapLoaded: boolean } }
        }).__resilienceMapE2E?.getState().mapLoaded),
        undefined,
        { timeout: 30_000 },
      )
      return
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
}

test('map site selection persists after a real canvas click', async ({ page }) => {
  test.skip(!!process.env.CI, 'MapLibre canvas requires GPU — not available in CI swiftshader')
  test.setTimeout(120_000)
  const site: SiteFixture = {
    id: 'site-center',
    name: 'Center Site',
    latitude: 20,
    longitude: 0,
    status: 'active',
    geofence_radius_km: 0,
  }

  await stubMapPageRoutes(page, { sites: [site] })
  await primeAuthenticatedSession(page)
  await enableE2EBridge(page)
  await waitForMapBridge(page)

  await page.waitForFunction(() =>
    Boolean((window as Window & {
      __resilienceMapE2E?: { getFirstSiteTarget: () => MapSelectionTarget | null }
    }).__resilienceMapE2E?.getFirstSiteTarget()),
  )

  const initialZoom = await page.evaluate(() => {
    const bridge = (window as Window & {
      __resilienceMapE2E?: { getState: () => { zoom: number | null } }
    }).__resilienceMapE2E
    return bridge?.getState().zoom ?? null
  })

  expect(initialZoom).not.toBeNull()

  const target = await page.evaluate(() => {
    const bridge = (window as Window & {
      __resilienceMapE2E?: { getFirstSiteTarget: () => MapSelectionTarget | null }
    }).__resilienceMapE2E
    return bridge?.getFirstSiteTarget() ?? null
  })

  expect(target).not.toBeNull()
  const siteTarget = target as MapSelectionTarget

  await page.waitForFunction((siteId: string) =>
    Boolean((window as Window & {
      __resilienceMapE2E?: { getPickableSiteCanvasTarget: (id: string) => CanvasPoint | null }
    }).__resilienceMapE2E?.getPickableSiteCanvasTarget(siteId)),
    siteTarget.id,
  )

  const point = await page.evaluate((siteId: string) => {
    const bridge = (window as Window & {
      __resilienceMapE2E?: { getPickableSiteCanvasTarget: (id: string) => CanvasPoint | null }
    }).__resilienceMapE2E
    return bridge?.getPickableSiteCanvasTarget(siteId) ?? null
  }, siteTarget.id)

  expect(point).not.toBeNull()
  const canvasPoint = point as CanvasPoint

  await page.locator('.maplibregl-canvas').click({
    position: { x: canvasPoint.x, y: canvasPoint.y },
  })

  await expect(page.locator('.map-panel-title')).toContainText(siteTarget.name)
  await expect(page).toHaveURL(new RegExp(`/map\\?site_id=${siteTarget.id}$`))

  await page.waitForTimeout(1500)
  await expect(page.locator('.map-panel-title')).toContainText(siteTarget.name)
  await expect(page).toHaveURL(new RegExp(`/map\\?site_id=${siteTarget.id}$`))

  const settledZoom = await page.evaluate(() => {
    const bridge = (window as Window & {
      __resilienceMapE2E?: { getState: () => { zoom: number | null } }
    }).__resilienceMapE2E
    return bridge?.getState().zoom ?? null
  })

  expect(settledZoom).not.toBeNull()
  expect(Math.abs((settledZoom as number) - (initialZoom as number))).toBeLessThan(0.01)
})

test('overlapping site and signal clicks still select the site', async ({ page }) => {
  test.skip(!!process.env.CI, 'MapLibre canvas requires GPU — not available in CI swiftshader')
  test.setTimeout(120_000)
  const site: SiteFixture = {
    id: 'site-overlap',
    name: 'Overlap Site',
    latitude: 20,
    longitude: 0,
    status: 'active',
    geofence_radius_km: 0,
  }
  const overlappingSignal: SignalFixture = {
    id: 'signal-overlap',
    source: 'gpsjam',
    signal_type: 'gps_jamming',
    external_id: 'signal-overlap-ext',
    lat: 20,
    lng: 0,
    occurred_at: '2026-03-25T15:59:00Z',
    ingested_at: '2026-03-25T15:59:00Z',
    raw_payload: { note: 'overlap fixture' },
    magnitude: null,
    altitude: null,
    speed: null,
    heading: null,
  }

  const routes = await stubMapPageRoutes(page, { sites: [site], signals: [overlappingSignal] })
  await primeAuthenticatedSession(page)
  await mockStableSignalStream(page)
  await enableE2EBridge(page)
  await waitForMapBridge(page)

  await routes.waitForSignalBaseline('gps_jamming')

  // Wait until the map can project the overlap coordinates after the signal
  // baseline request has been served. We avoid getPickableSiteCanvasTarget
  // here because at the overlap position queryRenderedFeatures returns the
  // signal (topmost hit) rather than the site, so that gate never resolves.
  await page.waitForFunction(({ lng, lat }: { lng: number; lat: number }) => {
    const bridge = (window as Window & {
      __resilienceMapE2E?: {
        projectPosition: (targetLng: number, targetLat: number) => CanvasPoint | null
      }
    }).__resilienceMapE2E

    return typeof bridge?.projectPosition === 'function' && Boolean(bridge.projectPosition(lng, lat))
  }, { lng: site.longitude, lat: site.latitude })

  const point = await page.evaluate(({ lng, lat }) => {
    const bridge = (window as Window & {
      __resilienceMapE2E?: {
        projectPosition: (targetLng: number, targetLat: number) => CanvasPoint | null
      }
    }).__resilienceMapE2E

    const projected = typeof bridge?.projectPosition === 'function'
      ? bridge.projectPosition(lng, lat)
      : null
    if (!projected) return null

    return {
      x: Math.round(projected.x),
      y: Math.round(projected.y),
    }
  }, { lng: site.longitude, lat: site.latitude })

  expect(point).not.toBeNull()
  const canvasPoint = point as CanvasPoint

  await page.locator('.maplibregl-canvas').click({
    position: { x: canvasPoint.x, y: canvasPoint.y },
  })

  await expect(page.locator('.map-panel-title')).toContainText(site.name)
  await expect(page).toHaveURL(new RegExp(`/map\\?site_id=${site.id}$`))
  expect(page.url()).not.toContain('signal_id=')
})
