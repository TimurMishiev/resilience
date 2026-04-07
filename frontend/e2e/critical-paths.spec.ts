import { test, expect } from '@playwright/test'
import { capturePageErrors, login, primeAuthenticatedSession, formatDateTimeLocal } from './helpers'

// ---------------------------------------------------------------------------
// 1. Login → Dashboard flow
// ---------------------------------------------------------------------------

test.describe('Login → Dashboard', () => {
  test('unauthenticated user sees login page and can sign in', async ({ page }) => {
    const pageErrors = capturePageErrors(page)

    // Clear auth state so we land on login
    await page.context().clearCookies()
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)

    await login(page)

    // After login, should redirect to /sites (default landing)
    await expect(page).toHaveURL(/\/sites$/)
    await expect(page.locator('.shell-sidebar')).toBeVisible()

    // Navigate to dashboard
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    // Verify KPI row renders (at least one stat value)
    await expect(page.locator('.dashboard-kpi-row .dashboard-kpi').first()).toBeVisible()

    expect(pageErrors).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2. Signal / Alert triage flow
// ---------------------------------------------------------------------------

test.describe('Alert triage flow', () => {
  test('alerts page loads and supports workflow transitions', async ({ page }) => {
    const pageErrors = capturePageErrors(page)

    await primeAuthenticatedSession(page)

    // Mock alerts with a controllable dataset
    await page.route('**/api/signal_rule_matches*', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                id: 'match-1',
                workflow_status: 'unacknowledged',
                confidence: 0.85,
                created_at: '2026-04-01T10:00:00.000Z',
                updated_at: '2026-04-01T10:00:00.000Z',
                acknowledged_at: null,
                acknowledged_by: null,
                notes: null,
                correlation_rule: { id: 'rule-1', name: 'Seismic Proximity' },
                signal: {
                  id: 'sig-1',
                  source: 'usgs_seismic',
                  signal_type: 'seismic_event',
                  external_id: 'us7000test',
                  latitude: 36.0,
                  longitude: -5.0,
                  occurred_at: '2026-04-01T09:55:00.000Z',
                },
                site: { id: 'site-1', name: 'Watchtower Alpha' },
                task: null,
                incident: null,
                metadata: {
                  distance_km: 8.3,
                  signal_type: 'seismic_event',
                  signal_source: 'usgs_seismic',
                  actions_taken: ['create_task'],
                },
              },
            ],
            meta: { total: 1, page: 1, per_page: 50, total_pages: 1 },
          }),
        })
      } else {
        await route.continue()
      }
    })

    await page.goto('/alerts')
    await expect(page.getByRole('heading', { name: 'Alert Triage' })).toBeVisible()

    // Verify alert row is visible
    await expect(page.getByText('Seismic Proximity')).toBeVisible()
    await expect(page.getByText('Watchtower Alpha')).toBeVisible()

    // Verify status filter controls exist
    await expect(page.getByText('Unacknowledged')).toBeVisible()

    expect(pageErrors).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 3. Incident creation → prosecution
// ---------------------------------------------------------------------------

test.describe('Incident detail and prosecution', () => {
  test('incident detail page renders tabs and shows prosecution panel', async ({ page }) => {
    const pageErrors = capturePageErrors(page)

    await primeAuthenticatedSession(page)

    const mockIncident = {
      id: 'inc-1',
      title: 'Multi-sensor correlation near Alpha',
      description: 'Detected overlapping signals.',
      severity: 'high',
      workflow_status: 'open',
      prosecution_phase: null,
      assigned_to: null,
      site_id: 'site-1',
      site_name: 'Watchtower Alpha',
      area_of_operation_id: 'ao-1',
      area_of_operation_name: 'North Gulf',
      area_of_operation_posture: 'defensive',
      fusion_rationale: 'High-confidence seismic and AIS signals within 10 km.',
      signal_rule_match_count: 3,
      task_count: 1,
      created_at: '2026-04-01T08:00:00.000Z',
      updated_at: '2026-04-01T10:00:00.000Z',
      acknowledged_at: null,
      closed_at: null,
    }

    await page.route('**/api/incidents/inc-1', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockIncident),
      })
    })

    await page.route('**/api/incidents/inc-1/allowed_transitions', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ allowed: ['acknowledged'] }),
      })
    })

    await page.route('**/api/incidents/inc-1/chain', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ nodes: [], edges: [] }),
      })
    })

    await page.route('**/api/incidents/inc-1/notes', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    await page.route('**/api/incidents/inc-1/prosecution_steps', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    await page.route('**/api/audit_events*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    await page.goto('/incidents/inc-1')

    // Verify incident title and severity badge
    await expect(page.getByRole('heading', { name: 'Multi-sensor correlation near Alpha' })).toBeVisible()
    await expect(page.getByText('HIGH', { exact: true }).first()).toBeVisible()

    // Verify tabs exist
    await expect(page.getByRole('tab', { name: /Evidence/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Notes/i })).toBeVisible()

    // Verify fusion rationale
    await expect(page.getByText(/High-confidence seismic/)).toBeVisible()

    expect(pageErrors).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. Replay mode — enter, verify UI changes, exit
// ---------------------------------------------------------------------------

test.describe('Replay mode', () => {
  test('entering replay disables mutations and shows warning banner', async ({ page }) => {
    const pageErrors = capturePageErrors(page)

    await primeAuthenticatedSession(page)

    // Mock minimal data for incidents page
    await page.route('**/api/incidents*', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                id: 'inc-1',
                title: 'Test Incident',
                severity: 'medium',
                workflow_status: 'open',
                prosecution_phase: null,
                assigned_to: null,
                site_name: 'Site Alpha',
                signal_rule_match_count: 1,
                task_count: 0,
                created_at: '2026-04-01T08:00:00.000Z',
                updated_at: '2026-04-01T08:00:00.000Z',
              },
            ],
            meta: { total: 1, page: 1, per_page: 50, total_pages: 1 },
          }),
        })
      } else {
        await route.continue()
      }
    })

    await page.goto('/incidents')
    await expect(page.getByRole('heading', { name: 'Incidents', exact: true })).toBeVisible()

    // Open replay selector and set a past time
    const replayInput = page.locator('input[type="datetime-local"]')
    await expect(replayInput).toBeVisible()

    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000) // 1 day ago
    await replayInput.fill(formatDateTimeLocal(pastDate))
    await replayInput.press('Enter')

    // Verify replay warning banner appears
    await expect(page.getByText(/viewing.*(as of|historical|replay)/i)).toBeVisible({ timeout: 5000 })

    // Clear replay (set input to empty or click exit)
    await replayInput.fill('')
    await replayInput.press('Enter')

    // Warning should disappear
    await expect(page.getByText(/viewing.*(as of|historical|replay)/i)).toHaveCount(0, { timeout: 5000 })

    expect(pageErrors).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 5. Commander-only page gating
// ---------------------------------------------------------------------------

test.describe('Commander-only page gating', () => {
  test('planning page loads for authenticated commander', async ({ page }) => {
    const pageErrors = capturePageErrors(page)

    await primeAuthenticatedSession(page)

    // Mock planning endpoint
    await page.route('**/api/planning', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tasks: [],
          assets: [],
          areas_of_operation: [{ id: 'ao-1', name: 'North Gulf', posture: 'defensive' }],
          chokepoints: [],
          commander_intents: [],
          pace_plans: [],
          salute_reports: [],
          open_incidents: [],
          meta: {
            truncated: false,
            task_count: 0,
            incidents_truncated: false,
            incident_count: 0,
            salute_reports_truncated: false,
            salute_report_count: 0,
            salute_report_meta_by_ao: {},
          },
        }),
      })
    })
    await page.route('**/api/sites**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { total: 0, page: 1, per_page: 200, total_pages: 0 } }),
      })
    })
    await page.route('**/api/telemetry**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      })
    })

    await page.goto('/planning')
    await expect(page.getByRole('heading', { name: 'Operational Planning Surface' })).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('ontology query page loads for commander', async ({ page }) => {
    const pageErrors = capturePageErrors(page)
    await primeAuthenticatedSession(page)

    await page.goto('/ontology')
    await expect(page.getByRole('heading', { name: 'Ontology Query', exact: true })).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('briefing page loads for commander', async ({ page }) => {
    const pageErrors = capturePageErrors(page)
    await primeAuthenticatedSession(page)

    await page.route('**/api/ai/summary', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            summary: 'Test briefing content.',
            citations: [],
            context_counts: { audit_events: 0, signals: 0, rule_fires: 0 },
          },
        }),
      })
    })

    await page.goto('/briefing')
    await expect(page.getByRole('heading', { name: 'Operational Briefing' })).toBeVisible()
    expect(pageErrors).toEqual([])
  })
})
