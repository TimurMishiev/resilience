import { test, expect } from '@playwright/test'
import {
  captureFailedRequests,
  capturePageErrors,
  enableE2EBridge,
  primeAuthenticatedSession,
} from './helpers'

type MapE2EState = {
  mapLoaded: boolean
  telemetryConnected: boolean
  signalsConnected: boolean
}

test('live map SSE streams stay healthy past the prior proxy timeout window', async ({ page }) => {
  test.skip(!!process.env.CI, 'MapLibre canvas requires GPU — not available in CI swiftshader')
  test.setTimeout(120_000)

  const pageErrors = capturePageErrors(page)
  const failedSseRequests = captureFailedRequests(
    page,
    url => /\/api\/(events|telemetry\/stream|signals\/stream)(\?|$)/.test(url),
  )

  await primeAuthenticatedSession(page)
  await enableE2EBridge(page)

  await page.goto('/map')
  await page.locator('.map-container').waitFor({ state: 'visible' })
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1)

  await page.waitForFunction(() => {
    const bridge = (window as Window & {
      __resilienceMapE2E?: { getState: () => MapE2EState }
    }).__resilienceMapE2E
    const state = bridge?.getState()
    return Boolean(state?.mapLoaded && state.telemetryConnected && state.signalsConnected)
  })

  await page.waitForTimeout(70_000)

  await page.waitForFunction(() => {
    const bridge = (window as Window & {
      __resilienceMapE2E?: { getState: () => MapE2EState }
    }).__resilienceMapE2E
    const state = bridge?.getState()
    return Boolean(state?.mapLoaded && state.telemetryConnected && state.signalsConnected)
  })

  expect(failedSseRequests).toEqual([])
  expect(pageErrors).toEqual([])
})
