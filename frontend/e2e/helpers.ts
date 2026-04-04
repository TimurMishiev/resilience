import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'

const E2E_DIR = dirname(fileURLToPath(import.meta.url))
const AUTH_STATE_PATH = resolve(E2E_DIR, '.auth/commander.json')
const AUTH_USER_PATH = resolve(E2E_DIR, '.auth/commander-user.json')
const SESSION_COOKIE_NAME = '_resilience_session'

export type RoleName = 'commander' | 'operator' | 'viewer'

const ROLE_CREDENTIALS: Record<RoleName, { email: string; password: string }> = {
  commander: { email: 'commander@resilience.mil', password: 'password123' },
  operator:  { email: 'operator@resilience.mil',  password: 'password123' },
  viewer:    { email: 'viewer@resilience.mil',     password: 'password123' },
}

export function authStatePath(role: RoleName): string {
  return resolve(E2E_DIR, `.auth/${role}.json`)
}

export function authUserPath(role: RoleName): string {
  return resolve(E2E_DIR, `.auth/${role}-user.json`)
}

type StorageStateCookie = {
  name: string
  domain?: string
  expires?: number
  secure?: boolean
}

type StorageStateShape = {
  cookies?: StorageStateCookie[]
}

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

export async function loginAs(page: Page, role: RoleName) {
  const { email, password } = ROLE_CREDENTIALS[role]

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto('/login')
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(password)

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

  throw new Error(`Playwright login as ${role} failed after exhausting rate-limit retries`)
}

function baseUrlAllowsSecureCookies(baseURL: string): boolean {
  try {
    return new URL(baseURL).protocol === 'https:'
  } catch {
    return false
  }
}

export function canReuseAuthArtifacts(baseURL: string, statePath?: string): boolean {
  const resolvedStatePath = statePath ?? AUTH_STATE_PATH
  const resolvedUserPath = statePath ? statePath.replace('.json', '-user.json') : AUTH_USER_PATH

  if (!existsSync(resolvedStatePath) || !existsSync(resolvedUserPath)) {
    return false
  }

  try {
    const state = JSON.parse(readFileSync(resolvedStatePath, 'utf8')) as StorageStateShape
    const cookie = state.cookies?.find(entry => entry.name === SESSION_COOKIE_NAME)
    if (!cookie) return false

    if (cookie.secure && !baseUrlAllowsSecureCookies(baseURL)) {
      return false
    }

    if (cookie.expires && cookie.expires > 0 && cookie.expires * 1000 <= Date.now() + 60_000) {
      return false
    }

    const hostname = new URL(baseURL).hostname
    if (cookie.domain && cookie.domain !== hostname && cookie.domain !== `.${hostname}`) {
      return false
    }

    return true
  } catch {
    return false
  }
}

async function hasAuthenticatedApiSession(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const response = await fetch('/api/sites', { credentials: 'include' })
    return response.status !== 401
  })
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

  await page.goto('/login')
  await page.evaluate((sessionUser) => {
    window.sessionStorage.setItem('resilience_user', JSON.stringify(sessionUser))
  }, user)

  if (!(await hasAuthenticatedApiSession(page))) {
    await login(page)
    return
  }

  await page.goto('/sites')
  if (/\/login(?:\?|$)/.test(page.url())) {
    await login(page)
  }
}

export async function primeRoleSession(page: Page, role: RoleName) {
  const userPath = authUserPath(role)
  let rawUser: string
  try {
    rawUser = readFileSync(userPath, 'utf8')
  } catch (error) {
    const details = error instanceof Error ? `: ${error.message}` : ''
    throw new Error(
      `Missing Playwright auth user fixture at ${userPath}${details}. ` +
      'Run the Playwright global setup first, or delete frontend/e2e/.auth and rerun the suite.',
    )
  }
  const user = JSON.parse(rawUser)

  await page.goto('/login')
  await page.evaluate((sessionUser) => {
    window.sessionStorage.setItem('resilience_user', JSON.stringify(sessionUser))
  }, user)

  if (!(await hasAuthenticatedApiSession(page))) {
    await loginAs(page, role)
    return
  }

  await page.goto('/sites')
  if (/\/login(?:\?|$)/.test(page.url())) {
    await loginAs(page, role)
  }
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
