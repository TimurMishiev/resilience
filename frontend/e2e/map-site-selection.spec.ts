import { test, expect } from '@playwright/test'
import { enableE2EBridge, primeAuthenticatedSession } from './helpers'

type MapSelectionTarget = {
  id: string
  name: string
}

type CanvasPoint = {
  x: number
  y: number
}

test('map site selection persists after a real canvas click', async ({ page }) => {
  const site = {
    id: 'site-center',
    name: 'Center Site',
    latitude: 20,
    longitude: 0,
    status: 'active',
    geofence_radius_km: 0,
  }

  await page.route('**/api/sites**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [site] }),
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
      body: JSON.stringify({ data: [], meta: { page: 1, total_pages: 1, total_count: 0 } }),
    })
  })
  await page.route('**/api/events**', async route => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: '',
    })
  })
  await page.route('**/api/telemetry/stream**', async route => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: '',
    })
  })
  await page.route('**/api/signals/stream**', async route => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: '',
    })
  })

  await primeAuthenticatedSession(page)
  await enableE2EBridge(page)

  await page.goto('/map')
  await page.locator('.map-container').waitFor({ state: 'visible' })
  await page.waitForFunction(() =>
    Boolean((window as Window & {
      __resilienceMapE2E?: { getState: () => { mapLoaded: boolean } }
    }).__resilienceMapE2E?.getState().mapLoaded),
  )

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
