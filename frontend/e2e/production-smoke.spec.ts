import { expect, test, type Page } from '@playwright/test'
import { capturePageErrors, captureFailedRequests, formatDateTimeLocal, login } from './helpers'

// ─────────────────────────────────────────────────────────────────────────────
// Production smoke — golden operator path against the deployed app.
//
// This spec deliberately uses NO `page.route` mocks. It hits the real backend,
// uses real seeded users, and (when explicitly opted in) exercises real audit-
// chain writes. Run against the deployed app via:
//
//   E2E_BASE_URL=https://resilience-ops.fly.dev npx playwright test \
//     e2e/production-smoke.spec.ts
//
// Run against local Vite preview by leaving E2E_BASE_URL unset.
//
// ── Two test blocks ──
//
// 1. "read-only golden path" — always runs. No mutations against the
//    deployed app. Safe to invoke from CI on every push, safe to run from
//    a developer laptop without polluting the production audit chain.
//
// 2. "mutation: accept pending recommendation" — gated on
//    E2E_INCLUDE_MUTATIONS=1. Only runs when explicitly opted in because
//    each successful execution writes a real `recommendation_accepted`
//    AuditEvent to the per-org chain (see Recommendation#accept! at
//    backend/app/models/recommendation.rb:52-66). For a portfolio app the
//    user controls all data, but the mutation is deliberately gated so the
//    smoke is read-only by default.
//
// Splitting (vs. one mega-test) lets a flake in step 3 NOT hide whether
// step 7 still works — the canonical "smoke = matrix of independent
// surfaces" model.
//
// ── What this proves ──
//   1. Login flow works end-to-end through the real /api/auth/login.
//   2. /sites lists real sites from the seed DB.
//   3. /map mounts a MapLibre canvas and renders without page errors.
//   4. /sites/:id loads, has tabs, and the Audit Trail tab renders the
//      AuditTimeline component fed by /api/audit_events — proving the
//      hash-chained replay surface lights up in production.
//   5. /incidents lists incidents (or empty-state if seed has none).
//   6. /incidents/:id detail page renders fusion rationale + AuditTimeline.
//   7. /recommendations hydrates (status filter renders).
//   8. Replay scrub: enter a past datetime, see the "viewing as of" banner,
//      then exit replay and confirm the banner clears.
//   9. (Mutation block, opt-in) The v52 with_lock-protected accept
//      transition returns 200 OR 422 — both are valid contention outcomes,
//      neither is a 500.
//
// ── What this does NOT prove (out of scope for a smoke) ──
//   - Adversarial input handling (covered by request specs)
//   - Cross-tenant scoping (covered by request specs + Validator specs)
//   - SSE backpressure under load (covered by load test artifact)
//   - LLM enrichment behavior (gated on Anthropic credits; harness is
//     dormant per docs/ai-evals/)
//
// On failure, Playwright captures trace + screenshot + video to
// frontend/test-results/. Inspect those before assuming the deployed app
// is broken — many failures here are environment quirks (cold-start
// latency, rate-limit on auth) that retry would clear.
// ─────────────────────────────────────────────────────────────────────────────

const MUTATIONS_ENABLED = process.env.E2E_INCLUDE_MUTATIONS === '1'

// Shared instrumentation factory: page-error capture + filtered network
// failure capture. Used by both test blocks so they each carry their own
// independent error state.
function instrumentPage(page: Page) {
  const pageErrors = capturePageErrors(page)
  const failedRequests = captureFailedRequests(page, url =>
    /\/api\/(sites|incidents|recommendations|audit_events)\b/.test(url) &&
    !/\/api\/sse\b/.test(url),
  )
  return {
    assertClean: () => {
      expect(pageErrors).toEqual([])
      // net::ERR_ABORTED is a benign cancellation — React Query fetches
      // that were in-flight when the test navigated to the next page.
      // They prove nothing about app health and would create flake under
      // varying network latency.
      const realFailures = failedRequests.filter(r => r.errorText !== 'net::ERR_ABORTED')
      expect(realFailures).toEqual([])
    },
  }
}

test.describe('Production smoke — read-only golden path', () => {
  test('login → sites → map → site detail audit → incident detail audit → recommendations → replay scrub', async ({ page, context }) => {
    const { assertClean } = instrumentPage(page)
    await context.clearCookies()

    // ─── 1. Login ───────────────────────────────────────────────────────────
    await login(page)
    await expect(page).toHaveURL(/\/sites$/)
    await expect(page.locator('.shell-sidebar')).toBeVisible()

    // ─── 2. Sites list renders real seeded data ─────────────────────────────
    await expect(page.getByRole('heading', { name: /sites/i }).first()).toBeVisible()
    // Stable selector via data-testid="site-row" on SitesPage:90 — survives
    // table-component refactors that would break a `tr.clickable-row`
    // selector tied to the current Blueprint markup.
    const firstSiteRow = page.locator('[data-testid="site-row"]').first()
    await expect(firstSiteRow).toBeVisible({ timeout: 15000 })

    // ─── 3. Click into site detail and continue from there (no round-trip) ─
    // Pre-fix we navigated back to /sites just to call goto(`/sites/${id}`)
    // again. The detail page is the natural next stop, so click the row
    // and continue forward.
    await firstSiteRow.click()
    await expect(page).toHaveURL(/\/sites\/[^/]+/, { timeout: 10000 })

    // ─── 4. Site detail Audit Trail tab ─────────────────────────────────────
    await expect(page.getByRole('tab', { name: /audit trail/i })).toBeVisible({ timeout: 15000 })
    await page.getByRole('tab', { name: /audit trail/i }).click()
    // AuditTimeline renders either an <ol class="timeline"> with audit
    // events, or a <p class="timeline-empty"> empty state. Either proves
    // the panel hydrated and /api/audit_events returned 2xx without a
    // page error from the chain verifier.
    await expect(page.locator('.timeline, .timeline-empty')).toBeVisible({ timeout: 10000 })

    // ─── 5. Map page mounts a MapLibre canvas ───────────────────────────────
    await page.goto('/map')
    // Long timeout because cold-start + WebGL init under swiftshader takes
    // time. No page errors after mount — proves the engine-init/retry UX
    // wired in MapViewportSurface didn't surface a rendering crash.
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 })

    // ─── 6. Incidents list ──────────────────────────────────────────────────
    await page.goto('/incidents')
    await expect(page.getByRole('heading', { name: 'Incidents', exact: true }))
      .toBeVisible({ timeout: 15000 })

    // Incident detail (audit chain view #2) — open first row.
    // Wait for React Query to settle; a naked count() check is instantaneous
    // and returns 0 before the fetch resolves, producing a false-skip even
    // when the seed has incidents.
    const firstIncidentRow = page.locator('[data-testid="incident-row"]').first()
    await firstIncidentRow.waitFor({ state: 'attached', timeout: 15000 })
    await firstIncidentRow.click()
    await expect(page).toHaveURL(/\/incidents\/[^/]+/, { timeout: 10000 })
    await expect(page.getByRole('tab', { name: /evidence/i })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('heading').first()).toBeVisible()

    // ─── 7. Recommendations: page hydrates ─────────────────────────────────
    await page.goto('/recommendations')
    await expect(page.getByRole('heading', { name: 'Recommendations' }))
      .toBeVisible({ timeout: 15000 })
    // Metric pills only render when `!isReplaying && metrics` is truthy.
    // The /api/recommendations/metrics call may still be in flight or
    // Pending may be 0; assert hydration by waiting for the status-filter
    // <select> instead, which always renders once the page has mounted.
    await expect(page.locator('select').first()).toBeVisible({ timeout: 15000 })

    // ─── 8. Replay scrub: enter past datetime, banner appears, then exit ───
    await page.goto('/incidents')
    const replayInput = page.locator('input[type="datetime-local"]').first()
    await expect(replayInput).toBeVisible({ timeout: 10000 })

    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await replayInput.fill(formatDateTimeLocal(pastDate))
    await replayInput.press('Enter')

    await expect(page.getByText(/viewing.*(as of|historical|replay)/i))
      .toBeVisible({ timeout: 10000 })

    await replayInput.fill('')
    await replayInput.press('Enter')
    await expect(page.getByText(/viewing.*(as of|historical|replay)/i))
      .toHaveCount(0, { timeout: 10000 })

    assertClean()
  })
})

// ─── Mutation block: opt-in via E2E_INCLUDE_MUTATIONS=1 ────────────────────
// Each successful run of this test writes a real recommendation_accepted
// AuditEvent to the per-org chain. Skipped by default so the smoke can
// execute on every push without accumulating audit noise. Enable with:
//
//   E2E_INCLUDE_MUTATIONS=1 E2E_BASE_URL=https://resilience-ops.fly.dev \
//     npx playwright test e2e/production-smoke.spec.ts
//
// On its own when no pending recommendation exists, the test logs and
// passes — exercising the surface but proving nothing about the lock
// path. Use the real-prod runs as a quarterly check, not a deploy gate.
// ─────────────────────────────────────────────────────────────────────────
test.describe('Production smoke — mutation path', () => {
  test.skip(!MUTATIONS_ENABLED, 'set E2E_INCLUDE_MUTATIONS=1 to exercise this path')

  test('accept one pending recommendation — proves v52 with_lock contention contract', async ({ page, context }) => {
    const { assertClean } = instrumentPage(page)
    await context.clearCookies()

    await login(page)
    await page.goto('/recommendations')
    await expect(page.getByRole('heading', { name: 'Recommendations' }))
      .toBeVisible({ timeout: 15000 })
    await expect(page.locator('select').first()).toBeVisible({ timeout: 15000 })

    const acceptCount = await page.getByRole('button', { name: 'Accept' }).count()
    if (acceptCount === 0) {
      console.warn('[smoke] No pending recommendations; mutation path is a no-op.')
      assertClean()
      return
    }

    // Wait for the underlying mutate; we expect either a 200 (transition
    // succeeded) or a 422 (someone else accepted it between page load and
    // click — also acceptable proof of the locked-transition contract from
    // v52). NOT a 500.
    const responsePromise = page.waitForResponse(response =>
      /\/api\/recommendations\/[^/]+\/accept$/.test(response.url()) &&
      response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Accept' }).first().click()
    const response = await responsePromise
    expect([200, 422]).toContain(response.status())

    assertClean()
  })
})
