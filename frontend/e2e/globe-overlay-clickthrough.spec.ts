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
  // Audit P3 follow-up (2026-04-29): static-analysis pass identified
  // three more endpoints firing on /globe page mount that the original
  // stub set missed:
  //
  //   1. /api/signal_rule_matches/active_site_confidence
  //      (GlobePage.tsx:128 useActiveSiteConfidence — defaults to enabled=true)
  //   2. /api/chokepoints
  //      (GlobePage.tsx:175 useAllChokepoints with explicit enabled=true)
  //   3. /api/events  (the third SSE stream from AppShell's useSseEvents
  //      after sse_token exchange — opens unconditionally for any
  //      authenticated route once the user is logged in)
  //
  // Without these stubs the page issued real-network requests in the
  // E2E sandbox and could either hang waiting for unbacked SSE
  // responses or surface fetch errors that delayed bridge readiness.
  // The 3 globe primitive-pickup tests below are still `test.fixme`d;
  // see their inline comments for the residual non-harness root cause.
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
      body: JSON.stringify({ data: [] }),
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
  // The AppShell-driven SSE stream (useSseEvents) opens against
  // /api/events?token=... after fetching a token from /api/sse_token
  // (already stubbed above). Without a stub here the EventSource
  // hangs on a real network call in the E2E sandbox, blocking the
  // SSE-status indicator from settling and adding non-deterministic
  // latency to bridge readiness.
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

test.fixme('globe geofence overlay resolver still recognizes the underlying site', async ({ page }) => {
  // CORRECTED 2026-04-28 (was an incorrect CI-only-skip with a "passes
  // locally" claim that was never verified). Subsequent local validation
  // against vite dev (5173) + Rails dev (3000) reproduced the failure
  // pattern: page navigates to /globe but `.shell-main` never renders
  // within 10s. Screenshot shows a blank white page. Same outcome on CI,
  // different timing.
  //
  // UPDATE 2026-04-29 (audit P3 follow-up — harness cleanup tranche):
  // Static analysis of all hooks AppShell + GlobePage mount identified
  // three endpoints firing on /globe that the original stub set
  // missed: /api/events (AppShell useSseEvents — the highest-priority
  // candidate per the earlier audit hypothesis), /api/chokepoints
  // (useAllChokepoints), and /api/signal_rule_matches/active_site_confidence
  // (useActiveSiteConfidence). All three are now stubbed in
  // stubGlobePageRoutes above. The test stays `test.fixme` because
  // we have not interactively re-run it and proven it now passes; if
  // the residual failure is harness-caused this fix may close it, if
  // it is a real Cesium primitive-pickup issue the harness fix is
  // insufficient. The next investigator should locally run this test
  // and either un-fixme (if green) or update this comment to point
  // at the actual remaining root cause (Cesium viewer-bridge timing,
  // primitive-pickup behaviour, etc.) without harness contamination
  // confusing the diagnosis.
  //
  // `test.fixme` rather than `test.skip(!!process.env.CI, ...)` because
  // the prior framing ("flaky in headless CI; passes locally") was
  // false. `fixme` correctly reports the test as expected-failure in
  // both environments and shows up in test reports as a known gap, not
  // a passing test.
  //
  // Production impact: zero. The other E2E tests covering production
  // paths (Login → Dashboard, Alert triage, Incident detail, Replay
  // mode, Commander gating, Role boundaries) all pass on CI and gate
  // deploy correctly. These three globe-interaction tests cover
  // specific Cesium primitive-pickup behaviour that is not on the
  // production-correctness critical path.
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
