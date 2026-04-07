import { test, expect } from '@playwright/test'
import { captureFailedRequests, capturePageErrors, formatDateTimeLocal, primeAuthenticatedSession } from './helpers'

test('map replay smoke: login, enter replay, and show replay-safe map warnings', async ({ page }) => {
  test.setTimeout(120_000)
  const pageErrors = capturePageErrors(page)
  const failedGlyphRequests = captureFailedRequests(
    page,
    url => /tiles\.basemaps\.cartocdn\.com\/fonts\//.test(url),
  )

  await primeAuthenticatedSession(page)
  await page.goto('/map')
  await page.locator('.map-container').waitFor({ state: 'visible', timeout: 15_000 })
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1, { timeout: 30_000 })
  await expect(page.locator('.replay-status-tag')).toContainText('LIVE')

  const replayInput = page.locator('input.replay-input')
  const replayDate = new Date(Date.now() - 10 * 60 * 1000)
  replayDate.setSeconds(0, 0)

  await replayInput.fill(formatDateTimeLocal(replayDate))
  await replayInput.blur()

  await expect(page.locator('.replay-status-tag')).toContainText('REPLAY')
  await expect(page.locator('.replay-banner')).toContainText('Viewing historical state as of')
  await expect(page.getByText('Replay limitations')).toBeVisible()
  await expect(page.getByText('AO overlays, geofence breach rings, and vessel enrichment are hidden during replay because those layers are only available as live state.')).toBeVisible()
  await expect(page.getByText(/TELEMETRY (LIVE|OFFLINE)/)).toHaveCount(0)
  expect(failedGlyphRequests).toEqual([])
  expect(pageErrors).toEqual([])
})
