import { test, expect } from '@playwright/test'
import { capturePageErrors, primeAuthenticatedSession } from './helpers'

test('signals page smoke: route loads without runtime errors', async ({ page }) => {
  // Signal ingestion runs on first boot; Docker Compose may take time to populate.
  test.setTimeout(120_000)

  const pageErrors = capturePageErrors(page)
  const signalRestStatuses: number[] = []
  page.on('response', response => {
    const url = response.url()
    // Only capture the REST endpoint, not the SSE stream (/api/signals/stream)
    if (url.includes('/api/signals') && !url.includes('/stream')) {
      signalRestStatuses.push(response.status())
    }
  })

  // Mock all SSE endpoints to prevent Puma thread exhaustion in CI.
  const emptyStream = { status: 200, headers: { 'content-type': 'text/event-stream' }, body: '' }
  await page.route('**/api/events**', route => route.fulfill(emptyStream))
  await page.route('**/api/telemetry/stream**', route => route.fulfill(emptyStream))
  await page.route('**/api/signals/stream**', route => route.fulfill(emptyStream))

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

  // Wait for the REST /api/signals response before asserting
  if (signalRestStatuses.length === 0) {
    await page.waitForResponse(
      response => response.url().includes('/api/signals') && !response.url().includes('/stream'),
      { timeout: 15_000 },
    ).catch(() => { /* may already have been captured */ })
  }

  // Verify the REST endpoint returned 200 (if we captured it).
  // The SSE stream is mocked, so only the REST index endpoint matters here.
  if (signalRestStatuses.length > 0) {
    expect(signalRestStatuses.some(status => status === 200)).toBe(true)
  }
  await expect(page.getByText('Failed to load signals')).toHaveCount(0)
  expect(pageErrors).toEqual([])
})
