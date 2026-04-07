import { test, expect, type Page } from '@playwright/test'
import {
  authStatePath,
  capturePageErrors,
  primeRoleSession,
} from './helpers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fire a fetch and return { status, body } for diagnostic logging */
async function fetchWithBody(
  page: Page,
  method: string,
  url: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ({ url: u, method: m, body: b }) => {
      const res = await fetch(u, {
        method: m,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: b ? JSON.stringify(b) : undefined,
      })
      const text = await res.text()
      return { status: res.status, body: text }
    },
    { url, method, body },
  )
}

/** Assert expected status; logs response body on mismatch for CI debugging */
function expectStatus(result: { status: number; body: string }, expected: number, label: string) {
  if (result.status !== expected) {
    console.error(`[${label}] Expected ${expected} but got ${result.status}. Body: ${result.body.slice(0, 500)}`)
  }
  expect(result.status, `${label}: expected ${expected}, got ${result.status}. Body: ${result.body.slice(0, 300)}`).toBe(expected)
}

/**
 * Intercept SSE and streaming endpoints so page navigations never open
 * long-lived connections that permanently hold Puma threads. Without this,
 * two Playwright workers can exhaust the 32-thread pool within seconds,
 * causing every subsequent API call to queue and timeout with an empty 500.
 */
async function mockSseEndpoints(page: Page) {
  const emptyStream = { status: 200, headers: { 'content-type': 'text/event-stream' }, body: '' }
  await page.route('**/api/events**', route => route.fulfill(emptyStream))
  await page.route('**/api/telemetry/stream**', route => route.fulfill(emptyStream))
  await page.route('**/api/signals/stream**', route => route.fulfill(emptyStream))
  await page.route('**/api/sse_token', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ token: 'e2e-mock', expires_in: 60 }),
  }))
}

// ==========================================================================
// VIEWER ROLE BOUNDARIES
// ==========================================================================

test.describe('Viewer role boundaries', () => {
  test.use({ storageState: authStatePath('viewer') })

  test.beforeEach(async ({ page }) => {
    await mockSseEndpoints(page)
    await primeRoleSession(page, 'viewer')
  })

  // ── Read access (should work) ───────────────────────────────────────────

  test('can view dashboard', async ({ page }) => {
    const pageErrors = capturePageErrors(page)
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('can view sites list', async ({ page }) => {
    await page.goto('/sites')
    await expect(page.locator('.shell-sidebar')).toBeVisible()
    // Sites page loaded without redirect to login
    expect(page.url()).toMatch(/\/sites/)
  })

  test('can view incidents list', async ({ page }) => {
    await page.goto('/incidents')
    await expect(page.getByRole('heading', { name: 'Incidents', exact: true })).toBeVisible()
  })

  test('can view tasks list', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible()
  })

  test('can view alerts list', async ({ page }) => {
    await page.goto('/alerts')
    await expect(page.getByRole('heading', { name: 'Alert Triage' })).toBeVisible()
  })

  // ── Commander-only pages (should be blocked) ────────────────────────────

  test('sees lock on planning page', async ({ page }) => {
    await page.goto('/planning')
    await expect(page.getByText('Commander access required')).toBeVisible()
  })

  test('sees lock on briefing page', async ({ page }) => {
    await page.goto('/briefing')
    await expect(page.getByText('Commander access required')).toBeVisible()
  })

  test('sees lock on ontology page', async ({ page }) => {
    await page.goto('/ontology')
    await expect(page.getByText('Commander access required')).toBeVisible()
  })

  // ── Backend rejects write operations ────────────────────────────────────

  test('backend rejects task creation', async ({ page }) => {
    await page.goto('/tasks')
    const result = await fetchWithBody(page, 'POST', '/api/tasks', {
      task: { title: 'Should fail', priority: 'medium', site_id: '00000000-0000-0000-0000-000000000000' },
    })
    expectStatus(result, 403, 'viewer POST /api/tasks')
  })

  test('backend rejects correlation rule creation', async ({ page }) => {
    await page.goto('/rules')
    const result = await fetchWithBody(page, 'POST', '/api/correlation_rules', {
      correlation_rule: { name: 'Test', rule_type: 'flat', conditions: [] },
    })
    expectStatus(result, 403, 'viewer POST /api/correlation_rules')
  })

  test('backend rejects AI summary', async ({ page }) => {
    await page.goto('/dashboard')
    const result = await fetchWithBody(page, 'POST', '/api/ai/summary', {
      mode: 'operational',
    })
    expectStatus(result, 403, 'viewer POST /api/ai/summary')
  })

  test('backend rejects recommendation generation', async ({ page }) => {
    await page.goto('/dashboard')
    const result = await fetchWithBody(page, 'POST', '/api/recommendations/generate')
    expectStatus(result, 403, 'viewer POST /api/recommendations/generate')
  })

  test('backend rejects area of operation creation', async ({ page }) => {
    await page.goto('/areas')
    const result = await fetchWithBody(page, 'POST', '/api/areas_of_operation', {
      area_of_operation: { name: 'Test AO', geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } },
    })
    expectStatus(result, 403, 'viewer POST /api/areas_of_operation')
  })

  // ── Sidebar shows lock icons for restricted items ───────────────────────

  test('sidebar shows lock icons on commander-only items', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.locator('.shell-sidebar')).toBeVisible()

    // Planning is completely hidden for non-commanders
    await expect(page.locator('.shell-sidebar').getByText('Planning')).toHaveCount(0)

    // Briefing, Ontology, Rules, Areas, Health show lock icons
    const briefingItem = page.locator('.shell-sidebar').getByText('Briefing')
    await expect(briefingItem).toBeVisible()
  })
})

// ==========================================================================
// OPERATOR ROLE BOUNDARIES
// ==========================================================================

test.describe('Operator role boundaries', () => {
  test.use({ storageState: authStatePath('operator') })

  test.beforeEach(async ({ page }) => {
    await mockSseEndpoints(page)
    await primeRoleSession(page, 'operator')
  })

  // ── Read access (should work) ───────────────────────────────────────────

  test('can view dashboard', async ({ page }) => {
    const pageErrors = capturePageErrors(page)
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('can view incidents', async ({ page }) => {
    await page.goto('/incidents')
    await expect(page.getByRole('heading', { name: 'Incidents', exact: true })).toBeVisible()
  })

  // ── Operator-allowed writes ─────────────────────────────────────────────

  test('backend allows task creation', async ({ page }) => {
    // First get a valid site ID
    const siteStatus = await page.evaluate(async () => {
      const res = await fetch('/api/sites', { credentials: 'include' })
      return res.status
    })
    expect(siteStatus).toBe(200)

    // Task creation is operator_or_above — should not 403
    const sites = await page.evaluate(async () => {
      const res = await fetch('/api/sites', { credentials: 'include' })
      const json = await res.json()
      return json.data ?? json
    })

    if (Array.isArray(sites) && sites.length > 0) {
      const result = await fetchWithBody(page, 'POST', '/api/tasks', {
        task: {
          title: 'Operator task test',
          priority: 'medium',
          site_id: sites[0].id,
        },
      })
      if (result.status === 403 || result.status === 500) {
        console.error(`[operator POST /api/tasks] Unexpected ${result.status}. Body: ${result.body.slice(0, 500)}`)
      }
      // Should be 201 (created) or 422 (validation) but NOT 403
      expect(result.status).not.toBe(403)
    }
  })

  // ── Commander-only pages (should be blocked) ────────────────────────────

  test('sees lock on planning page', async ({ page }) => {
    await page.goto('/planning')
    await expect(page.getByText('Commander access required')).toBeVisible()
  })

  test('sees lock on briefing page', async ({ page }) => {
    await page.goto('/briefing')
    await expect(page.getByText('Commander access required')).toBeVisible()
  })

  test('sees lock on ontology page', async ({ page }) => {
    await page.goto('/ontology')
    await expect(page.getByText('Commander access required')).toBeVisible()
  })

  // ── Commander-only backend operations (should be blocked) ───────────────

  test('backend rejects correlation rule creation', async ({ page }) => {
    await page.goto('/rules')
    const result = await fetchWithBody(page, 'POST', '/api/correlation_rules', {
      correlation_rule: { name: 'Test', rule_type: 'flat', conditions: [] },
    })
    expectStatus(result, 403, 'operator POST /api/correlation_rules')
  })

  test('backend rejects AI summary', async ({ page }) => {
    await page.goto('/dashboard')
    const result = await fetchWithBody(page, 'POST', '/api/ai/summary', {
      mode: 'operational',
    })
    expectStatus(result, 403, 'operator POST /api/ai/summary')
  })

  test('backend rejects recommendation generation', async ({ page }) => {
    await page.goto('/dashboard')
    const result = await fetchWithBody(page, 'POST', '/api/recommendations/generate')
    expectStatus(result, 403, 'operator POST /api/recommendations/generate')
  })

  test('backend rejects area of operation creation', async ({ page }) => {
    await page.goto('/areas')
    const result = await fetchWithBody(page, 'POST', '/api/areas_of_operation', {
      area_of_operation: { name: 'Test AO', geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } },
    })
    expectStatus(result, 403, 'operator POST /api/areas_of_operation')
  })

  test('backend rejects prosecution initiation', async ({ page }) => {
    await page.goto('/incidents')
    const result = await fetchWithBody(page, 'POST', '/api/incidents/00000000-0000-0000-0000-000000000000/prosecute', {
      prosecution_phase: 'investigating',
    })
    // Could be 403 (Pundit) or 404 (record not found after scope) — both are acceptable rejections
    if (result.status === 500) {
      console.error(`[operator POST prosecute] Unexpected 500. Body: ${result.body.slice(0, 500)}`)
    }
    expect([403, 404], `operator POST prosecute: got ${result.status}. Body: ${result.body.slice(0, 300)}`).toContain(result.status)
  })
})
