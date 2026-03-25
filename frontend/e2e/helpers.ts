import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'

const E2E_DIR = dirname(fileURLToPath(import.meta.url))
const AUTH_USER_PATH = resolve(E2E_DIR, '.auth/commander-user.json')

export function formatDateTimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export async function login(page: Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto('/login')
    await page.locator('#email').fill('commander@resilience.mil')
    await page.locator('#password').fill('password123')

    const responsePromise = page.waitForResponse(response =>
      response.url().endsWith('/api/auth/login') && response.request().method() === 'POST',
    )

    await page.getByRole('button', { name: 'Sign in' }).click()
    const response = await responsePromise

    if (response.status() === 429) {
      const retryAfter = Number(response.headers()['retry-after'] ?? '5')
      await page.waitForTimeout((retryAfter + 1) * 1000)
      continue
    }

    await expect(page).toHaveURL(/\/sites$/)
    return
  }

  throw new Error('Playwright login failed after exhausting rate-limit retries')
}

export async function primeAuthenticatedSession(page: Page) {
  let rawUser: string
  try {
    rawUser = readFileSync(AUTH_USER_PATH, 'utf8')
  } catch (error) {
    const details = error instanceof Error ? `: ${error.message}` : ''
    throw new Error(
      `Missing Playwright auth user fixture at ${AUTH_USER_PATH}${details}. ` +
      'Run the Playwright global setup first, or delete frontend/e2e/.auth and rerun the suite.',
    )
  }
  const user = JSON.parse(rawUser)

  await page.addInitScript((sessionUser) => {
    window.sessionStorage.setItem('resilience_user', JSON.stringify(sessionUser))
  }, user)
}

export async function enableE2EBridge(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('resilience.e2e', '1')
  })
}

export function capturePageErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', error => {
    errors.push(error.message)
  })
  return errors
}

type FailedRequest = {
  url: string
  errorText: string
}

export function captureFailedRequests(
  page: Page,
  predicate: (url: string) => boolean = () => true,
) {
  const failures: FailedRequest[] = []
  page.on('requestfailed', request => {
    const url = request.url()
    if (!predicate(url)) return

    failures.push({
      url,
      errorText: request.failure()?.errorText ?? 'unknown',
    })
  })
  return failures
}
