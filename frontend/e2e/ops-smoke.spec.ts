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
