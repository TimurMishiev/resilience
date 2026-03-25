import { test, expect } from '@playwright/test'
import { formatDateTimeLocal, primeAuthenticatedSession } from './helpers'

test('globe replay smoke: login, enter replay, and show replay-safe globe copy', async ({ page }) => {
  await primeAuthenticatedSession(page)
  await page.goto('/globe')
  await page.locator('.globe-container').waitFor({ state: 'visible' })
  await expect(page.locator('.replay-status-tag')).toContainText('LIVE')

  const replayInput = page.locator('input.replay-input')
  const replayDate = new Date(Date.now() - 10 * 60 * 1000)
  replayDate.setSeconds(0, 0)

  await replayInput.fill(formatDateTimeLocal(replayDate))
  await replayInput.blur()

  await expect(page.locator('.replay-status-tag')).toContainText('REPLAY')
  await expect(page.locator('.replay-banner')).toContainText('Viewing historical state as of')
  await expect(page.locator('.globe-toolbar-hint')).toContainText(
    'Replay mode hides live-only AO posture, breach overlays, and vessel enrichment data.',
  )
})
