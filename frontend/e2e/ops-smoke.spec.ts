import { expect, test } from '@playwright/test'
import { capturePageErrors, primeAuthenticatedSession } from './helpers'

const PAGE_SMOKES = [
  { path: '/dashboard', heading: 'Dashboard' },
  { path: '/alerts', heading: 'Alert Triage' },
  { path: '/incidents', heading: 'Incidents' },
  { path: '/rules', heading: 'Correlation Rules' },
] as const

for (const pageSmoke of PAGE_SMOKES) {
  test(`${pageSmoke.path} smoke: route loads without runtime errors`, async ({ page }) => {
    const pageErrors = capturePageErrors(page)

    await primeAuthenticatedSession(page)
    await page.goto(pageSmoke.path)

    await expect(page.locator('.shell-sidebar')).toBeVisible()
    await expect(page.getByRole('heading', { name: pageSmoke.heading })).toBeVisible()
    await expect(page.getByText(/^Failed to load/i)).toHaveCount(0)
    expect(pageErrors).toEqual([])
  })
}

test('briefing smoke: page loads and summary generation surfaces grounded output', async ({ page }) => {
  const pageErrors = capturePageErrors(page)

  await primeAuthenticatedSession(page)
  await page.route('**/api/ai/summary', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          summary: 'Leadership summary generated from stubbed smoke-test data.',
          citations: ['12345678-abcd-efgh'],
          context_counts: {
            audit_events: 2,
            signals: 1,
            rule_fires: 1,
          },
        },
      }),
    })
  })

  await page.goto('/briefing')

  await expect(page.getByRole('heading', { name: 'Operational Briefing' })).toBeVisible()
  await page.getByRole('button', { name: 'Generate briefing' }).click()

  await expect(page.getByText('Leadership summary generated from stubbed smoke-test data.')).toBeVisible()
  await expect(page.getByText('Grounded in 4 records')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('command palette smoke: commander can jump to planning with the keyboard palette', async ({ page }) => {
  const pageErrors = capturePageErrors(page)
  const shortcut = process.platform === 'darwin' ? 'Meta+KeyK' : 'Control+KeyK'

  await primeAuthenticatedSession(page)

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
          salute_report_meta_by_ao: { 'ao-1': { truncated: false, count: 0 } },
        },
      }),
    })
  })
  await page.route('**/api/sites**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'site-1',
            name: 'Watchtower Bravo',
            latitude: 10,
            longitude: 20,
            status: 'active',
            area_of_operation_id: 'ao-1',
            geofence_radius_km: 10,
          },
        ],
        meta: { total: 1, page: 1, per_page: 200, total_pages: 1 },
      }),
    })
  })
  await page.route('**/api/telemetry', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    })
  })
  await page.goto('/dashboard')

  await page.locator('body').click()
  await page.keyboard.press(shortcut)
  await expect(page.locator('.gs-modal')).toBeVisible()

  await page.getByPlaceholder('Search commands, pages, sites, tasks, assets…').fill('planning')
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL(/\/planning$/)
  await expect(page.getByRole('heading', { name: 'Operational Planning Surface' })).toBeVisible()
  expect(pageErrors).toEqual([])
})
