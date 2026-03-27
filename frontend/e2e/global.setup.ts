import { chromium, type FullConfig } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canReuseAuthArtifacts, login } from './helpers'

const DEFAULT_E2E_BASE_URL = 'http://127.0.0.1:4178'

const E2E_DIR = dirname(fileURLToPath(import.meta.url))
const AUTH_STATE_PATH = resolve(E2E_DIR, '.auth/commander.json')
const AUTH_USER_PATH = resolve(E2E_DIR, '.auth/commander-user.json')

export default async function globalSetup(config: FullConfig) {
  mkdirSync(dirname(AUTH_STATE_PATH), { recursive: true })

  const baseURL = config.projects[0]?.use?.baseURL
  const resolvedBaseURL = typeof baseURL === 'string' ? baseURL : DEFAULT_E2E_BASE_URL

  // Reuse auth artifacts on local reruns only when they are still compatible
  // with the current base URL. This self-heals stale secure-cookie artifacts
  // from older HTTPS runs when local preview uses plain HTTP.
  if (canReuseAuthArtifacts(resolvedBaseURL)) {
    return
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
    ],
  })

  const page = await browser.newPage({
    baseURL: resolvedBaseURL,
  })

  await login(page)
  const user = await page.evaluate(() => window.sessionStorage.getItem('resilience_user'))
  if (!user) {
    throw new Error('Expected resilience_user in sessionStorage after Playwright login')
  }
  await page.context().storageState({ path: AUTH_STATE_PATH })
  writeFileSync(AUTH_USER_PATH, user)
  await browser.close()
}
