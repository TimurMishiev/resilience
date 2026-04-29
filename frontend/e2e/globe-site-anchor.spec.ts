import { test, expect, type Page } from '@playwright/test'
import { enableE2EBridge, primeAuthenticatedSession } from './helpers'

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

type GlobeTarget = {
  id: string
  name: string
  latitude: number
  longitude: number
}

type GlobeCanvasPoint = {
  x: number
  y: number
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

async function stubGlobePageRoutes(
  page: Page,
  {
    sites,
    signals = [],
  }: {
    sites: SiteFixture[]
    signals?: SignalFixture[]
  },
) {
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
  await page.route('**/api/signal_rule_matches/active_breach_sites**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ site_ids: [] }),
    })
  })
  // Audit P3 follow-up (2026-04-29): see globe-overlay-clickthrough.spec.ts
  // for the rationale. Three endpoints firing on /globe page mount were
  // missing from the original stub set:
  //   - /api/signal_rule_matches/active_site_confidence (useActiveSiteConfidence)
  //   - /api/chokepoints                                 (useAllChokepoints)
  //   - /api/events                                      (AppShell useSseEvents)
  await page.route('**/api/signal_rule_matches/active_site_confidence**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ summaries: [] }),
    })
  })
  await page.route('**/api/chokepoints**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyPaginatedResponse()),
    })
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
  })
  await page.route('**/api/signals/stream**', async route => {
    await route.fulfill(CONNECTED_SSE_RESPONSE)
  })
  await page.route('**/api/telemetry/stream**', async route => {
    await route.fulfill(EMPTY_SSE_RESPONSE)
  })
  // AppShell-driven SSE stream — see globe-overlay-clickthrough.spec.ts
  // for full rationale.
  await page.route('**/api/events**', async route => {
    await route.fulfill(CONNECTED_SSE_RESPONSE)
  })
}

async function waitForGlobeBridge(page: Page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto('/globe')
    await expect(page).toHaveURL(/\/globe(?:\?.*)?$/)

    try {
      await page.locator('.shell-main').waitFor({ state: 'visible', timeout: 10_000 })
      await page.locator('.globe-container').waitFor({ state: 'visible', timeout: 10_000 })
      await page.locator('.globe-container canvas').first().waitFor({ state: 'visible', timeout: 10_000 })
      await page.waitForFunction(() => {
        const bridge = (window as Window & {
          __resilienceGlobeE2E?: {
            getState: () => { viewerReady: boolean }
            getFirstSiteTarget?: () => GlobeTarget | null
            projectPosition?: (lng: number, lat: number) => GlobeCanvasPoint | null
          }
        }).__resilienceGlobeE2E

        return Boolean(
          bridge?.getState().viewerReady &&
          typeof bridge.getFirstSiteTarget === 'function' &&
          typeof bridge.projectPosition === 'function',
        )
      })
      return
    } catch (error) {
      if (attempt === 1) throw error
    }
  }
}

async function dragGlobe(page: Page) {
  const container = page.locator('.globe-container')
  let globeBox: { x: number; y: number; width: number; height: number } | null = null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await container.waitFor({ state: 'visible', timeout: 10_000 })
      globeBox = await container.boundingBox() as { x: number; y: number; width: number; height: number } | null
      if (globeBox) break
    } catch (error) {
      if (attempt === 1) throw error
      await waitForGlobeBridge(page)
    }
  }

  expect(globeBox).not.toBeNull()
  const safeGlobeBox = globeBox as { x: number; y: number; width: number; height: number }

  await page.mouse.move(safeGlobeBox.x + safeGlobeBox.width * 0.5, safeGlobeBox.y + safeGlobeBox.height * 0.48)
  await page.mouse.down()
  await page.mouse.move(safeGlobeBox.x + safeGlobeBox.width * 0.58, safeGlobeBox.y + safeGlobeBox.height * 0.5, { steps: 16 })
  await page.mouse.up()
}

async function readProjectedPositions(
  page: Page,
  target: GlobeTarget,
) {
  await page.waitForFunction(({ lng, lat, idString }) => {
    const bridge = (window as Window & {
      __resilienceGlobeE2E?: {
        projectPosition: (targetLng: number, targetLat: number) => GlobeCanvasPoint | null
        projectRenderedPosition: (targetId: string) => GlobeCanvasPoint | null
      }
    }).__resilienceGlobeE2E
    return Boolean(bridge?.projectPosition(lng, lat))
      && Boolean(bridge?.projectRenderedPosition(idString))
  }, { lng: target.longitude, lat: target.latitude, idString: target.id })

  const positions = await page.evaluate(({ lng, lat, idString }) => {
    const bridge = (window as Window & {
      __resilienceGlobeE2E?: {
        projectPosition: (targetLng: number, targetLat: number) => GlobeCanvasPoint | null
        projectRenderedPosition: (targetId: string) => GlobeCanvasPoint | null
      }
    }).__resilienceGlobeE2E
    return {
      world: bridge?.projectPosition(lng, lat) ?? null,
      rendered: bridge?.projectRenderedPosition(idString) ?? null,
    }
  }, { lng: target.longitude, lat: target.latitude, idString: target.id })

  expect(positions.world).not.toBeNull()
  expect(positions.rendered).not.toBeNull()

  return {
    world: positions.world as GlobeCanvasPoint,
    rendered: positions.rendered as GlobeCanvasPoint,
  }
}

test('globe site remains pinned to its projected coordinates after drag rotation', async ({ page }) => {
  const siteFixture: SiteFixture = {
    id: 'site-anchor',
    name: 'Anchor Site',
    latitude: 20,
    longitude: 0,
    status: 'active',
    geofence_radius_km: 0,
  }
  const signal: SignalFixture = {
    id: 'signal-anchor',
    source: 'gpsjam',
    signal_type: 'gps_jamming',
    external_id: 'signal-anchor-ext',
    lat: 24,
    lng: 6,
    occurred_at: '2026-03-25T15:59:00Z',
    ingested_at: '2026-03-25T15:59:00Z',
    raw_payload: { note: 'globe-anchor-fixture' },
    magnitude: null,
    altitude: null,
    speed: null,
    heading: null,
  }

  await stubGlobePageRoutes(page, { sites: [siteFixture], signals: [signal] })
  await primeAuthenticatedSession(page)
  await enableE2EBridge(page)
  await waitForGlobeBridge(page)

  const target = await page.evaluate(() => {
    const bridge = (window as Window & {
      __resilienceGlobeE2E?: { getFirstSiteTarget: () => GlobeTarget | null }
    }).__resilienceGlobeE2E
    return bridge?.getFirstSiteTarget() ?? null
  })

  expect(target).not.toBeNull()
  const site = target as GlobeTarget

  const focused = await page.evaluate((siteId: string) => {
    const bridge = (window as Window & {
      __resilienceGlobeE2E?: { flyToSite: (id: string) => boolean }
    }).__resilienceGlobeE2E
    return bridge?.flyToSite(siteId) ?? false
  }, site.id)
  expect(focused).toBe(true)

  await page.waitForTimeout(1800)
  await dragGlobe(page)

  const positions = await readProjectedPositions(page, {
    ...site,
    id: `site-${site.id}`,
  })
  const siteDeltaPx = Math.hypot(
    positions.world.x - positions.rendered.x,
    positions.world.y - positions.rendered.y,
  )

  expect(siteDeltaPx).toBeLessThanOrEqual(4)
})

test('globe signal remains pinned to its projected coordinates after drag rotation', async ({ page }) => {
  const siteFixture: SiteFixture = {
    id: 'site-anchor',
    name: 'Anchor Site',
    latitude: 20,
    longitude: 0,
    status: 'active',
    geofence_radius_km: 0,
  }
  const signalFixture: SignalFixture = {
    id: 'signal-anchor',
    source: 'gpsjam',
    signal_type: 'gps_jamming',
    external_id: 'signal-anchor-ext',
    lat: 24,
    lng: 6,
    occurred_at: '2026-03-25T15:59:00Z',
    ingested_at: '2026-03-25T15:59:00Z',
    raw_payload: { note: 'globe-anchor-fixture' },
    magnitude: null,
    altitude: null,
    speed: null,
    heading: null,
  }

  await stubGlobePageRoutes(page, { sites: [siteFixture], signals: [signalFixture] })
  await primeAuthenticatedSession(page)
  await enableE2EBridge(page)
  await waitForGlobeBridge(page)

  await page.waitForFunction(() => {
    const bridge = (window as Window & {
      __resilienceGlobeE2E?: { getFirstSignalTarget: () => GlobeTarget | null }
    }).__resilienceGlobeE2E
    return Boolean(bridge?.getFirstSignalTarget())
  })

  const target = await page.evaluate(() => {
    const bridge = (window as Window & {
      __resilienceGlobeE2E?: { getFirstSignalTarget: () => GlobeTarget | null }
    }).__resilienceGlobeE2E
    return bridge?.getFirstSignalTarget() ?? null
  })

  expect(target).not.toBeNull()
  const signal = target as GlobeTarget

  const focused = await page.evaluate((signalId: string) => {
    const bridge = (window as Window & {
      __resilienceGlobeE2E?: { flyToSignal: (id: string) => boolean }
    }).__resilienceGlobeE2E
    return bridge?.flyToSignal(signalId) ?? false
  }, signal.id)
  expect(focused).toBe(true)

  await page.waitForTimeout(1800)
  await dragGlobe(page)

  const positions = await readProjectedPositions(page, {
    ...signal,
    id: `signal-${signal.id}`,
  })
  const signalDeltaPx = Math.hypot(
    positions.world.x - positions.rendered.x,
    positions.world.y - positions.rendered.y,
  )

  expect(signalDeltaPx).toBeLessThanOrEqual(4)
})
