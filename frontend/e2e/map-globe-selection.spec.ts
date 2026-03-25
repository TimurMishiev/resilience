import { test, expect } from '@playwright/test'
import { enableE2EBridge, primeAuthenticatedSession } from './helpers'

type MapSelectionTarget = {
  id: string
  name: string
}

test('map to globe to map preserves selected site context', async ({ page }) => {
  await primeAuthenticatedSession(page)
  await enableE2EBridge(page)

  await page.goto('/map')
  await page.locator('.map-container').waitFor({ state: 'visible' })
  await page.waitForFunction(() =>
    Boolean((window as Window & {
      __resilienceMapE2E?: { getFirstSiteTarget: () => MapSelectionTarget | null }
    }).__resilienceMapE2E?.getFirstSiteTarget()),
  )

  const target = await page.evaluate(() => {
    const bridge = (window as Window & {
      __resilienceMapE2E?: { getFirstSiteTarget: () => MapSelectionTarget | null }
    }).__resilienceMapE2E
    return bridge?.getFirstSiteTarget() ?? null
  })

  expect(target).not.toBeNull()
  const site = target as MapSelectionTarget

  await page.goto(`/map?site_id=${site.id}`)
  await expect(page).toHaveURL(new RegExp(`/map\\?site_id=${site.id}$`))

  await page.locator('.shell-sidebar').getByText('Globe', { exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/globe\\?site_id=${site.id}$`))
  await page.waitForFunction(() =>
    Boolean((window as Window & {
      __resilienceGlobeE2E?: { getState: () => { viewerReady: boolean } }
    }).__resilienceGlobeE2E?.getState().viewerReady),
  )
  await expect(page.locator('.globe-panel-title')).toContainText(site.name)

  await page.locator('.shell-sidebar').getByText('Map', { exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/map\\?site_id=${site.id}$`))
})
