import { expect, test, type Page } from '@playwright/test'
import { capturePageErrors, primeAuthenticatedSession } from './helpers'

const EMPTY_SSE_RESPONSE = {
  status: 200,
  headers: { 'content-type': 'text/event-stream' },
  body: '',
}

type PlanningState = {
  tasks: unknown[]
  assets: unknown[]
  areas_of_operation: Array<{ id: string; name: string; posture: string }>
  chokepoints: Array<Record<string, unknown>>
  commander_intents: Array<Record<string, unknown>>
  pace_plans: Array<Record<string, unknown>>
  salute_reports: Array<Record<string, unknown>>
  open_incidents: unknown[]
  meta: Record<string, unknown>
}

async function stubPlanningRoutes(page: Page) {
  const ao = { id: 'ao-1', name: 'North Gulf', posture: 'defensive' }
  const state: PlanningState = {
    tasks: [],
    assets: [],
    areas_of_operation: [ao],
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
      salute_report_meta_by_ao: {
        'ao-1': { truncated: false, count: 0 },
      },
    },
  }

  await page.route('**/api/sse_token', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'e2e-sse-token', expires_in: 60 }),
    })
  })
  await page.route('**/api/events**', async route => {
    await route.fulfill(EMPTY_SSE_RESPONSE)
  })
  await page.route('**/api/telemetry/stream**', async route => {
    await route.fulfill(EMPTY_SSE_RESPONSE)
  })
  await page.route('**/api/areas_of_operation**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [ao], meta: { total: 1, page: 1, per_page: 50, total_pages: 1 } }),
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
  await page.route(url => {
    const href = typeof url === 'string' ? url : url.href
    return new URL(href).pathname === '/api/telemetry'
  }, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    })
  })
  await page.route('**/api/planning', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state),
    })
  })
  await page.route('**/api/commander_intents', async route => {
    const payload = route.request().postDataJSON() as { commander_intent: Record<string, string> }
    state.commander_intents = [{
      id: 'intent-1',
      area_of_operation_id: ao.id,
      created_by_id: 'user-1',
      updated_by_id: 'user-1',
      created_at: '2026-03-27T12:00:00Z',
      updated_at: '2026-03-27T12:00:00Z',
      ...payload.commander_intent,
    }]
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(state.commander_intents[0]),
    })
  })
  await page.route('**/api/chokepoints', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: state.chokepoints, meta: { total: state.chokepoints.length, page: 1, per_page: 50, total_pages: 1 } }),
      })
      return
    }

    const payload = route.request().postDataJSON() as { chokepoint: Record<string, string | number> }
    state.chokepoints = [{
      id: 'chokepoint-1',
      area_of_operation_id: ao.id,
      area_of_operation_name: ao.name,
      created_by_id: 'user-1',
      updated_by_id: 'user-1',
      created_at: '2026-03-27T12:01:30Z',
      updated_at: '2026-03-27T12:01:30Z',
      ...payload.chokepoint,
    }]
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(state.chokepoints[0]),
    })
  })
  await page.route('**/api/pace_plans', async route => {
    const payload = route.request().postDataJSON() as { pace_plan: Record<string, string> }
    state.pace_plans = [{
      id: 'pace-1',
      area_of_operation_id: ao.id,
      created_by_id: 'user-1',
      updated_by_id: 'user-1',
      created_at: '2026-03-27T12:01:00Z',
      updated_at: '2026-03-27T12:01:00Z',
      ...payload.pace_plan,
    }]
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(state.pace_plans[0]),
    })
  })
  await page.route('**/api/salute_reports', async route => {
    const payload = route.request().postDataJSON() as { salute_report: Record<string, string> }
    state.salute_reports = [{
      id: 'salute-1',
      area_of_operation_id: ao.id,
      area_of_operation_name: 'North Gulf',
      site_name: 'Watchtower Bravo',
      created_by_id: 'user-1',
      created_at: '2026-03-27T12:02:00Z',
      ...payload.salute_report,
    }]
    state.meta.salute_report_meta_by_ao['ao-1'] = { truncated: false, count: state.salute_reports.length }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(state.salute_reports[0]),
    })
  })
}

test('planning doctrine smoke: commander can save intent, chokepoints, PACE, and SALUTE doctrine', async ({ page }) => {
  const pageErrors = capturePageErrors(page)

  await stubPlanningRoutes(page)
  await primeAuthenticatedSession(page)
  await page.goto('/planning')

  await expect(page.getByRole('heading', { name: 'Operational Planning Surface' })).toBeVisible()

  await page.getByLabel('Intent title').fill('Hold corridor')
  await page.getByLabel('Objective').fill('Maintain ISR over the corridor.')
  await page.getByLabel('End state').fill('Coverage gap closed before dawn.')
  await page.getByRole('button', { name: 'Save commander intent' }).click()
  await expect(page.getByText('Commander intent saved.')).toBeVisible()

  await page.locator('#chokepoint-name').fill('Hormuz East')
  await page.locator('#chokepoint-latitude').fill('25.285447')
  await page.locator('#chokepoint-longitude').fill('56.334457')
  await page.getByRole('button', { name: 'Create chokepoint' }).click()
  await expect(page.getByText('Chokepoint created.')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Hormuz East' })).toBeVisible()

  await page.getByLabel('Primary').fill('SATCOM mission chat')
  await page.getByLabel('Alternate').fill('Secure VHF relay')
  await page.getByLabel('Contingency').fill('Burst SMS gateway')
  await page.getByLabel('Emergency').fill('HF voice net')
  await page.getByRole('button', { name: 'Save PACE plan' }).click()
  await expect(page.getByText('PACE plan saved.')).toBeVisible()

  await page.getByLabel('Size').fill('2 fast boats')
  await page.getByLabel('Activity').fill('Shadowing patrol route')
  await page.getByLabel('Location').fill('Harbor ingress')
  await page.getByRole('button', { name: 'Submit SALUTE report' }).click()

  await expect(page.getByText('SALUTE report submitted.')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Shadowing patrol route' })).toBeVisible()
  expect(pageErrors).toEqual([])
})
