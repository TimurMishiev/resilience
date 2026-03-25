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

const EMPTY_SSE_RESPONSE = {
  status: 200,
  headers: { 'content-type': 'text/event-stream' },
  body: '',
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
) {
  await page.route('**/api/sites**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: sites }),
    })
  })
  await page.route('**/api/tasks**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    })
  })
  await page.route('**/api/assets**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    })
  })
  await page.route('**/api/areas_of_operation**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    })
  })
  await page.route('**/api/risk_scores**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })
  await page.route('**/api/signal_rule_matches/active_breach_site_ids**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ site_ids: [] }),
    })
  })
  await page.route('**/api/signals**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: signals,
        meta: { page: 1, total_pages: 1, total_count: signals.length },
      }),
    })
  })
  await page.route('**/api/events**', async route => {
    await route.fulfill(EMPTY_SSE_RESPONSE)
  })
  await page.route('**/api/telemetry/stream**', async route => {
    await route.fulfill(EMPTY_SSE_RESPONSE)
  })
  await page.route('**/api/signals/stream**', async route => {
    await route.fulfill(EMPTY_SSE_RESPONSE)
  })
}

async function waitForMapBridge(page: Page) {
  await page.goto('/map')
  await page.locator('.map-container').waitFor({ state: 'visible' })
  await page.waitForFunction(() =>
    Boolean((window as Window & {
      __resilienceMapE2E?: { getState: () => { mapLoaded: boolean } }
    }).__resilienceMapE2E?.getState().mapLoaded),
  )
}

test('map site selection persists after a real canvas click', async ({ page }) => {
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

  await stubMapPageRoutes(page, { sites: [site], signals: [overlappingSignal] })
  await primeAuthenticatedSession(page)
  await enableE2EBridge(page)
  await waitForMapBridge(page)

  await page.waitForFunction((target: { lng: number; lat: number }) => {
    const bridge = (window as Window & {
      __resilienceMapE2E?: {
        projectPosition: (lng: number, lat: number) => CanvasPoint | null
      }
    }).__resilienceMapE2E

    return bridge?.projectPosition(target.lng, target.lat) ?? false
  }, { lng: site.longitude, lat: site.latitude })

  await page.waitForTimeout(1000)

  const point = await page.evaluate(({ lng, lat }) => {
    const bridge = (window as Window & {
      __resilienceMapE2E?: {
        projectPosition: (targetLng: number, targetLat: number) => CanvasPoint | null
      }
    }).__resilienceMapE2E

    const projected = bridge?.projectPosition(lng, lat)
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
