import { test, expect } from '@playwright/test'
import { capturePageErrors, primeAuthenticatedSession } from './helpers'

test('signals page smoke: route loads without runtime errors', async ({ page }) => {
  // Signal ingestion runs on first boot; Docker Compose may take time to populate.
  test.setTimeout(120_000)

  const pageErrors = capturePageErrors(page)
  const signalResponseStatuses: number[] = []
  page.on('response', response => {
    if (response.url().includes('/api/signals')) {
      signalResponseStatuses.push(response.status())
    }
  })

  await primeAuthenticatedSession(page)
  await page.goto('/signals')

  await expect(page.locator('.signal-feed-page')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Signal Feed' })).toBeVisible()

  await page.waitForFunction(() => {
    const hasLoadedSignalRow = Array.from(document.querySelectorAll('.signal-feed-table tbody tr')).some(row => {
      const hasSignalTags = row.querySelectorAll('.bp6-tag').length >= 2
      const hasMonoText = Array.from(row.querySelectorAll('td.mono')).some(cell => (cell.textContent ?? '').trim().length > 0)
      return hasSignalTags && hasMonoText
    })
    const emptyState = document.querySelector('.bp6-non-ideal-state')
    const errorCallout = document.body.innerText.includes('Failed to load signals')
    // Accept skeleton/loading state — SSE stream may not deliver signals in CI
    const skeletonVisible = document.querySelector('.signal-feed-table .bp6-skeleton') !== null
    return Boolean(hasLoadedSignalRow || emptyState || errorCallout || skeletonVisible)
  })

  await expect(page.locator('.shell-sidebar')).toBeVisible()

  // Wait for at least one /api/signals response (REST or SSE) before asserting
  if (signalResponseStatuses.length === 0) {
    await page.waitForResponse(
      response => response.url().includes('/api/signals'),
      { timeout: 15_000 },
    ).catch(() => { /* may already have been captured */ })
  }

  expect(signalResponseStatuses.some(status => status === 200)).toBe(true)
  await expect(page.getByText('Failed to load signals')).toHaveCount(0)
  expect(pageErrors).toEqual([])
})
