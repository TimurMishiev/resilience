import { test, expect, type Page } from '@playwright/test'
import { enableE2EBridge, primeAuthenticatedSession } from './helpers'

type GlobeTarget = {
  id: string
  name: string
  latitude: number
  longitude: number
}

type SiteFixture = {
  id: string
  name: string
  latitude: number
  longitude: number
  status: string
  geofence_radius_km: number
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

test.use({ serviceWorkers: 'block' })

async function stubGlobePageRoutes(page: Page, sites: SiteFixture[]) {
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
  await page.route('**/api/signal_rule_matches/active_breach_sites**', async route => {
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
        data: [],
        meta: { page: 1, total_pages: 1, total_count: 0 },
      }),
    })
  })
  await page.route('**/api/signals/stream**', async route => {
    await route.fulfill(CONNECTED_SSE_RESPONSE)
  })
  await page.route('**/api/telemetry/stream**', async route => {
    await route.fulfill(EMPTY_SSE_RESPONSE)
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
            getFirstGeofenceTarget?: () => GlobeTarget | null
          }
        }).__resilienceGlobeE2E

        return Boolean(
          bridge?.getState().viewerReady &&
          typeof bridge.getFirstGeofenceTarget === 'function',
        )
      })
      return
    } catch (error) {
      if (attempt === 1) throw error
    }
  }
}

test('globe geofence overlay resolver still recognizes the underlying site', async ({ page }) => {
  const site: SiteFixture = {
    id: 'site-geofence',
    name: 'Geofence Site',
    latitude: 20,
    longitude: 0,
    status: 'active',
    geofence_radius_km: 10,
  }

  await stubGlobePageRoutes(page, [site])
  await primeAuthenticatedSession(page)
  await enableE2EBridge(page)
  await waitForGlobeBridge(page)

  const geofenceTarget = await page.evaluate(() => {
    const bridge = (window as Window & {
      __resilienceGlobeE2E?: { getFirstGeofenceTarget: () => GlobeTarget | null }
    }).__resilienceGlobeE2E
    return bridge?.getFirstGeofenceTarget() ?? null
  })
  expect(geofenceTarget).not.toBeNull()

  const siteTarget = geofenceTarget as GlobeTarget

  const pickedSite = await page.evaluate((siteId) => {
    const bridge = (window as Window & {
      __resilienceGlobeE2E?: { pickSiteThroughGeofenceOverlay: (id: string) => boolean }
    }).__resilienceGlobeE2E
    return bridge?.pickSiteThroughGeofenceOverlay(siteId) ?? false
  }, siteTarget.id)
  expect(pickedSite).toBe(true)

  // Confirm the synthetic overlay pick propagated through React selection
  // state rather than only returning true from the bridge helper.
  await page.waitForFunction((siteId: string) => {
    const bridge = (window as Window & {
      __resilienceGlobeE2E?: { getState: () => { selectedSiteId: string | null } }
    }).__resilienceGlobeE2E
    return bridge?.getState().selectedSiteId === siteId
  }, siteTarget.id)
})
