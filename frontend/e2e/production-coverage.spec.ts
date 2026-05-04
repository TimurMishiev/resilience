import { expect, test, type Page } from '@playwright/test'
import { capturePageErrors, captureFailedRequests, primeAuthenticatedSession } from './helpers'

// ─────────────────────────────────────────────────────────────────────────────
// Production coverage matrix — every authenticated SPA route loads without
// page errors and renders its distinctive content.
//
// Run against deployed prod via:
//
//   E2E_BASE_URL=https://resilience-ops.fly.dev npx playwright test \
//     e2e/production-coverage.spec.ts
//
// What this proves:
//   For every route in App.tsx the page hydrates, fetches its data, and
//   renders without throwing a `pageerror`. This is the broad version of
//   manual click-through QA — what a human does to convince themselves the
//   app is demoable end-to-end.
//
// What this does NOT prove:
//   - Per-page interaction flows (covered by production-smoke.spec.ts and
//     existing critical-paths.spec.ts).
//   - Visual regressions (would need pixel diffing — not in scope).
//   - Role-restricted views (covered by role-boundaries.spec.ts).
//
// ── Discovery: routes are listed in App.tsx ──────────────────────────────────
//   Run: grep '<Route path=' frontend/src/App.tsx
//
// ── Test layout ──────────────────────────────────────────────────────────────
//   - One test per route. Granular failures pinpoint the broken surface.
//   - Each test logs in via the cached commander session (global setup).
//     Fresh login per test would hit the auth rate-limiter against prod;
//     reuse the cached session unless a test explicitly clears cookies.
//   - Routes that need an ID (/sites/:id, /incidents/:id) capture the
//     first row from the parent list page and navigate from there.
//   - WebGL routes (/map, /globe) use a longer timeout because cold-start
//     plus swiftshader init can take 20s+.
// ─────────────────────────────────────────────────────────────────────────────

interface RouteCheck {
  name: string
  path: string
  // Selector that must be visible after navigation. Either a Blueprint
  // heading by text, a canvas (WebGL routes), or a known structural
  // element. Strings are passed to page.locator(); RegExps to getByText.
  expect: { kind: 'text'; pattern: RegExp } | { kind: 'locator'; selector: string }
  // Timeout for the visibility assertion. Defaults to 15000.
  timeout?: number
  // If true, skip the no-page-errors assertion. Used for routes whose
  // third-party libs emit benign console errors on first paint.
  allowPageErrors?: boolean
}

// Static-ID-free routes — drive each one and assert the heading/element
// renders. Order roughly follows the sidebar nav order so the first
// failure points at where in the operator's flow the break happened.
const ROUTES: RouteCheck[] = [
  { name: 'Sites',               path: '/sites',           expect: { kind: 'text', pattern: /^Sites$/ } },
  { name: 'Dashboard',           path: '/dashboard',       expect: { kind: 'text', pattern: /^Dashboard$/ } },
  { name: 'Map',                 path: '/map',             expect: { kind: 'locator', selector: 'canvas' }, timeout: 30000 },
  { name: 'Globe',               path: '/globe',           expect: { kind: 'locator', selector: 'canvas' }, timeout: 30000 },
  { name: 'Graph',               path: '/graph',           expect: { kind: 'locator', selector: 'canvas, svg' }, timeout: 20000 },
  { name: 'Tasks',               path: '/tasks',           expect: { kind: 'text', pattern: /^Tasks$/ } },
  { name: 'Assets',              path: '/assets',          expect: { kind: 'text', pattern: /^Assets$/ } },
  { name: 'Incidents',           path: '/incidents',       expect: { kind: 'text', pattern: /^Incidents$/ } },
  { name: 'Recommendations',     path: '/recommendations', expect: { kind: 'text', pattern: /^Recommendations$/ } },
  { name: 'Alert Triage',        path: '/alerts',          expect: { kind: 'text', pattern: /Alert Triage/ } },
  { name: 'Signal Feed',         path: '/signals',         expect: { kind: 'text', pattern: /Signal Feed/ } },
  { name: 'Correlation Rules',   path: '/rules',           expect: { kind: 'text', pattern: /Correlation Rules/ } },
  { name: 'Areas of Operation',  path: '/areas',           expect: { kind: 'text', pattern: /Areas of Operation/ } },
  { name: 'Operational Health',  path: '/health',          expect: { kind: 'text', pattern: /Operational/ } },
  { name: 'Planning',            path: '/planning',        expect: { kind: 'text', pattern: /Operational Planning/ } },
  { name: 'Briefing',            path: '/briefing',        expect: { kind: 'text', pattern: /Operational Briefing/ } },
  { name: 'Debrief',             path: '/debrief',         expect: { kind: 'text', pattern: /^Debrief$/ } },
  { name: 'Ontology Query',      path: '/ontology',        expect: { kind: 'text', pattern: /Ontology Query/ } },
  { name: 'Security',            path: '/security',        expect: { kind: 'text', pattern: /^Security$/ } },
  { name: 'Swimlane',            path: '/swimlane',        expect: { kind: 'text', pattern: /Swimlane/i } },
  // /organizations and /users are admin-only per OrganizationPolicy:2 and
  // UserPolicy:4. The default commander seed user can't index either. They
  // are covered by separate role-boundaries.spec.ts using an admin/operator
  // role grid; this commander-driven coverage matrix correctly skips them
  // rather than asserting on a 403 / empty state.
]

// Shared instrumentation — page-error capture + filtered network failure
// capture. Used by every test so any surface that throws gets caught.
function instrumentPage(page: Page) {
  const pageErrors = capturePageErrors(page)
  const failedRequests = captureFailedRequests(page, url =>
    /\/api\//.test(url) && !/\/api\/sse\b/.test(url),
  )
  return {
    assertClean: ({ allowPageErrors }: { allowPageErrors?: boolean } = {}) => {
      if (!allowPageErrors) {
        expect(pageErrors).toEqual([])
      }
      const realFailures = failedRequests.filter(r => r.errorText !== 'net::ERR_ABORTED')
      expect(realFailures).toEqual([])
    },
  }
}

// Use the canonical primeAuthenticatedSession helper instead of a
// home-grown URL-check. The DIY approach raced with the React
// ProtectedRoute's client-side redirect to /login: after page.goto
// resolved, the SPA hydrated, observed missing session storage, and
// navigated to /login AFTER my regex check had already passed.
// primeAuthenticatedSession seeds both the cookie (via global setup's
// commander.json) AND sessionStorage (via commander-user.json), so the
// SPA's auth state is populated before the test asserts anything.

// ─── Per-route smoke ───────────────────────────────────────────────────────
test.describe('Production coverage — every route loads', () => {
  for (const route of ROUTES) {
    test(`${route.name} (${route.path})`, async ({ page }) => {
      const { assertClean } = instrumentPage(page)
      await primeAuthenticatedSession(page)

      await page.goto(route.path)

      const timeout = route.timeout ?? 15000
      if (route.expect.kind === 'text') {
        await expect(page.getByText(route.expect.pattern).first())
          .toBeVisible({ timeout })
      } else {
        await expect(page.locator(route.expect.selector).first())
          .toBeVisible({ timeout })
      }

      assertClean({ allowPageErrors: route.allowPageErrors })
    })
  }
})

// ─── ID-bearing detail routes ──────────────────────────────────────────────
// /sites/:id and /incidents/:id need a real ID. Capture the first row from
// the parent list page (data-testid added in commit 6305182) and navigate
// in. If no row exists (empty seed), skip rather than fail — the parent
// list test above already proved the surface works.
test.describe('Production coverage — detail pages', () => {
  test('Site detail', async ({ page }) => {
    const { assertClean } = instrumentPage(page)
    await primeAuthenticatedSession(page)

    await page.goto('/sites')
    const firstRow = page.locator('[data-testid="site-row"]').first()
    // Wait for the table to render its data — rows are fetched via React
    // Query and aren't in the DOM at navigation time. A naked count() check
    // is instantaneous and returns 0 before the fetch settles, producing
    // false "no data" skips. Wait for the row to be attached, then proceed.
    await firstRow.waitFor({ state: 'attached', timeout: 15000 })
    await firstRow.click()
    await expect(page).toHaveURL(/\/sites\/[^/]+/, { timeout: 10000 })
    // Site name renders as the heading; the existence of any h2 in the
    // page hero proves render success.
    await expect(page.locator('h2').first()).toBeVisible({ timeout: 15000 })

    assertClean()
  })

  test('Incident detail', async ({ page }) => {
    const { assertClean } = instrumentPage(page)
    await primeAuthenticatedSession(page)

    await page.goto('/incidents')
    const firstRow = page.locator('[data-testid="incident-row"]').first()
    // Same React Query timing concern as Site detail above.
    await firstRow.waitFor({ state: 'attached', timeout: 15000 })
    await firstRow.click()
    await expect(page).toHaveURL(/\/incidents\/[^/]+/, { timeout: 10000 })
    // Evidence tab is mandatory on every incident detail page.
    await expect(page.getByRole('tab', { name: /evidence/i }))
      .toBeVisible({ timeout: 15000 })

    assertClean()
  })
})
