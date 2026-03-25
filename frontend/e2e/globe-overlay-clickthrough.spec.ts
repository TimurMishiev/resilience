import { test, expect } from '@playwright/test'
import { enableE2EBridge, primeAuthenticatedSession } from './helpers'

type GlobeTarget = {
  id: string
  name: string
}

test('globe geofence overlay resolver still recognizes the underlying site', async ({ page }) => {
  await primeAuthenticatedSession(page)
  await enableE2EBridge(page)

  await page.goto('/globe')
  await page.locator('.globe-container').waitFor({ state: 'visible' })
  await page.waitForFunction(() =>
    Boolean((window as Window & {
      __resilienceGlobeE2E?: { getState: () => { viewerReady: boolean } }
    }).__resilienceGlobeE2E?.getState().viewerReady),
  )

  const geofenceTarget = await page.evaluate(() => {
    const bridge = (window as Window & {
      __resilienceGlobeE2E?: { getFirstGeofenceTarget: () => GlobeTarget | null }
    }).__resilienceGlobeE2E
    return bridge?.getFirstGeofenceTarget() ?? null
  })
  expect(geofenceTarget).not.toBeNull()

  const site = geofenceTarget as GlobeTarget

  const pickedSite = await page.evaluate((siteId) => {
    const bridge = (window as Window & {
      __resilienceGlobeE2E?: { pickSiteThroughGeofenceOverlay: (id: string) => boolean }
    }).__resilienceGlobeE2E
    return bridge?.pickSiteThroughGeofenceOverlay(siteId) ?? false
  }, site.id)
  expect(pickedSite).toBe(true)
})
