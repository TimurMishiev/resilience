import { chromium, type FullConfig } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  authStatePath,
  authUserPath,
  canReuseAuthArtifacts,
  login,
  loginAs,
  type RoleName,
} from './helpers'

const DEFAULT_E2E_BASE_URL = 'http://127.0.0.1:4178'

const E2E_DIR = dirname(fileURLToPath(import.meta.url))
const AUTH_DIR = resolve(E2E_DIR, '.auth')

// Commander is the default auth state used by all existing tests
const AUTH_STATE_PATH = resolve(AUTH_DIR, 'commander.json')
const AUTH_USER_PATH = resolve(AUTH_DIR, 'commander-user.json')

const EXTRA_ROLES: RoleName[] = ['operator', 'viewer']

export default async function globalSetup(config: FullConfig) {
  mkdirSync(AUTH_DIR, { recursive: true })

  const baseURL = config.projects[0]?.use?.baseURL
  const resolvedBaseURL = typeof baseURL === 'string' ? baseURL : DEFAULT_E2E_BASE_URL

  // ── Commander (primary) ──────────────────────────────────────────────────
  if (!canReuseAuthArtifacts(resolvedBaseURL)) {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--use-angle=swiftshader',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
      ],
    })

    const page = await browser.newPage({ baseURL: resolvedBaseURL })
    await login(page)
    const user = await page.evaluate(() =>
      window.sessionStorage.getItem('resilience_user'),
    )
    if (!user) {
      throw new Error(
        'Expected resilience_user in sessionStorage after Playwright login',
      )
    }
    await page.context().storageState({ path: AUTH_STATE_PATH })
    writeFileSync(AUTH_USER_PATH, user)
    await browser.close()
  }

  // ── Operator + Viewer (role-boundary tests) ──────────────────────────────
  for (const role of EXTRA_ROLES) {
    const statePath = authStatePath(role)
    const userPath = authUserPath(role)

    // Reuse if artifacts already exist and are valid
    if (canReuseAuthArtifacts(resolvedBaseURL, statePath)) continue

    const browser = await chromium.launch({
      headless: true,
      args: [
        '--use-angle=swiftshader',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
      ],
    })

    const page = await browser.newPage({ baseURL: resolvedBaseURL })
    await loginAs(page, role)
    const user = await page.evaluate(() =>
      window.sessionStorage.getItem('resilience_user'),
    )
    if (!user) {
      throw new Error(
        `Expected resilience_user in sessionStorage after Playwright login as ${role}`,
      )
    }
    await page.context().storageState({ path: statePath })
    writeFileSync(userPath, user)
    await browser.close()
  }
}
