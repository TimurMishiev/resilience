import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanningResponse } from '../api/types'

const planningState = vi.hoisted(() => ({
  isCommander: true,
  isReplaying: false,
  updateTask: {
    mutate: vi.fn(),
    isPending: false,
    variables: null as null | { id: string },
  },
  createCommanderIntent: {
    mutateAsync: vi.fn(async () => ({})),
    isPending: false,
  },
  updateCommanderIntent: {
    mutateAsync: vi.fn(async () => ({})),
    isPending: false,
  },
  createPacePlan: {
    mutateAsync: vi.fn(async () => ({})),
    isPending: false,
  },
  updatePacePlan: {
    mutateAsync: vi.fn(async () => ({})),
    isPending: false,
  },
  createSaluteReport: {
    mutateAsync: vi.fn(async () => ({})),
    isPending: false,
  },
  createChokepoint: {
    mutateAsync: vi.fn(async () => ({
      id: 'cp-1',
      area_of_operation_id: 'ao-1',
      area_of_operation_name: 'North Gulf',
      name: 'Hormuz East',
      category: 'strait',
      status: 'monitor',
      latitude: 25.285447,
      longitude: 56.334457,
      watch_radius_km: 25,
      notes: null,
      created_by_id: 'user-1',
      updated_by_id: 'user-1',
      created_at: '2026-03-27T12:00:00Z',
      updated_at: '2026-03-27T12:00:00Z',
    })),
    isPending: false,
  },
  updateChokepoint: {
    mutateAsync: vi.fn(async () => ({
      id: 'cp-1',
      area_of_operation_id: 'ao-1',
      area_of_operation_name: 'North Gulf',
      name: 'Hormuz East',
      category: 'strait',
      status: 'monitor',
      latitude: 25.285447,
      longitude: 56.334457,
      watch_radius_km: 25,
      notes: null,
      created_by_id: 'user-1',
      updated_by_id: 'user-1',
      created_at: '2026-03-27T12:00:00Z',
      updated_at: '2026-03-27T12:00:00Z',
    })),
    isPending: false,
  },
  deleteChokepoint: {
    mutateAsync: vi.fn(async () => undefined),
    isPending: false,
  },
  planning: {
    tasks: [],
    assets: [],
    areas_of_operation: [
      { id: 'ao-1', name: 'North Gulf', posture: 'defensive' },
    ],
    chokepoints: [],
    commander_intents: [],
    pace_plans: [],
    salute_reports: [],
    open_incidents: [],
    meta: {
      truncated: false,
      task_count: 0,
      assets_truncated: false,
      asset_count: 0,
      areas_truncated: false,
      area_count: 0,
      chokepoints_truncated: false,
      chokepoint_count: 0,
      intents_truncated: false,
      intent_count: 0,
      pace_plans_truncated: false,
      pace_plan_count: 0,
      incidents_truncated: false,
      incident_count: 0,
      salute_reports_truncated: false,
      salute_report_count: 0,
      salute_report_meta_by_ao: { 'ao-1': { truncated: false, count: 0 } },
    },
  } as PlanningResponse,
  sites: [
    { id: 'site-1', name: 'Watchtower Bravo', latitude: 10, longitude: 20, status: 'active', area_of_operation_id: 'ao-1', geofence_radius_km: 10 },
  ],
}))

vi.mock('../hooks/usePlanning', () => ({
  usePlanning: () => ({
    data: planningState.planning,
    isLoading: false,
    isError: false,
  }),
}))

vi.mock('../hooks/useSites', () => ({
  useSites: () => ({
    data: { data: planningState.sites },
    isLoading: false,
    isError: false,
  }),
}))

vi.mock('../hooks/useTasks', () => ({
  useUpdateTask: () => planningState.updateTask,
}))

vi.mock('../hooks/usePlanningDoctrine', () => ({
  useCreateCommanderIntent: () => planningState.createCommanderIntent,
  useUpdateCommanderIntent: () => planningState.updateCommanderIntent,
  useCreatePacePlan: () => planningState.createPacePlan,
  useUpdatePacePlan: () => planningState.updatePacePlan,
  useCreateSaluteReport: () => planningState.createSaluteReport,
}))

vi.mock('../hooks/useChokepoints', () => ({
  useCreateChokepoint: () => planningState.createChokepoint,
  useUpdateChokepoint: () => planningState.updateChokepoint,
  useDeleteChokepoint: () => planningState.deleteChokepoint,
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => ({
    isCommander: planningState.isCommander,
  }),
}))

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({
    isReplaying: planningState.isReplaying,
  }),
}))

vi.mock('../hooks/useTelemetry', () => ({
  useTelemetry: () => ({
    readings: new Map(),
  }),
}))

vi.mock('../components/AssetPicker', () => ({
  AssetPicker: () => <div data-testid="asset-picker" />,
}))

vi.mock('../components/EntityCard', () => ({
  default: () => <div data-testid="entity-card" />,
}))

import PlanningPage from '../pages/PlanningPage'

function renderPlanningPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <PlanningPage />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

describe('PlanningPage', () => {
  beforeEach(() => {
    planningState.isCommander = true
    planningState.isReplaying = false
    planningState.createCommanderIntent.mutateAsync.mockClear()
    planningState.updateCommanderIntent.mutateAsync.mockClear()
    planningState.createPacePlan.mutateAsync.mockClear()
    planningState.updatePacePlan.mutateAsync.mockClear()
    planningState.createSaluteReport.mutateAsync.mockClear()
    planningState.createChokepoint.mutateAsync.mockClear()
    planningState.updateChokepoint.mutateAsync.mockClear()
    planningState.deleteChokepoint.mutateAsync.mockClear()
    planningState.planning = {
      tasks: [],
      assets: [],
      areas_of_operation: [
        { id: 'ao-1', name: 'North Gulf', posture: 'defensive' },
      ],
      chokepoints: [],
      commander_intents: [],
      pace_plans: [],
      salute_reports: [],
      open_incidents: [],
      meta: {
        truncated: false,
        task_count: 0,
        assets_truncated: false,
        asset_count: 0,
        areas_truncated: false,
        area_count: 0,
        chokepoints_truncated: false,
        chokepoint_count: 0,
        intents_truncated: false,
        intent_count: 0,
        pace_plans_truncated: false,
        pace_plan_count: 0,
        incidents_truncated: false,
        incident_count: 0,
        salute_reports_truncated: false,
        salute_report_count: 0,
        salute_report_meta_by_ao: { 'ao-1': { truncated: false, count: 0 } },
      },
    }
    planningState.sites = [
      { id: 'site-1', name: 'Watchtower Bravo', latitude: 10, longitude: 20, status: 'active', area_of_operation_id: 'ao-1', geofence_radius_km: 10 },
    ]
  })

  it('shows commander doctrine controls for commanders', () => {
    renderPlanningPage()

    expect(screen.getByRole('heading', { name: /Operational Planning Surface/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Commander Doctrine/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Maritime Chokepoints/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save commander intent/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save PACE plan/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Submit SALUTE report/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create chokepoint/i })).toBeInTheDocument()
  })

  it('submits a new commander intent for the selected AO', async () => {
    const user = userEvent.setup()
    renderPlanningPage()

    await user.type(screen.getByLabelText(/Intent title/i), 'Hold corridor')
    await user.type(screen.getByLabelText(/^Objective$/i), 'Maintain ISR over the corridor.')
    await user.type(screen.getByLabelText(/End state/i), 'No coverage gaps remain.')
    await user.click(screen.getByRole('button', { name: /Save commander intent/i }))

    await waitFor(() => {
      expect(planningState.createCommanderIntent.mutateAsync).toHaveBeenCalledWith({
        area_of_operation_id: 'ao-1',
        title: 'Hold corridor',
        objective: 'Maintain ISR over the corridor.',
        end_state: 'No coverage gaps remain.',
        constraints: null,
      })
    })
    expect(screen.getByText(/Commander intent saved/i)).toBeInTheDocument()
  })

  it('re-seeds commander intent and PACE drafts when the selected AO changes', async () => {
    const user = userEvent.setup()
    planningState.planning = {
      ...planningState.planning,
      areas_of_operation: [
        { id: 'ao-1', name: 'North Gulf', posture: 'defensive' },
        { id: 'ao-2', name: 'South Gulf', posture: 'observe' },
      ],
      commander_intents: [
        {
          id: 'intent-2',
          area_of_operation_id: 'ao-2',
          title: 'Hold southern lanes',
          objective: 'Maintain escort coverage.',
          end_state: 'Commercial traffic moves without interruption.',
          constraints: 'Avoid escalation near civilian traffic.',
          created_by_id: 'user-1',
          updated_by_id: 'user-1',
          created_at: '2026-03-27T12:00:00Z',
          updated_at: '2026-03-27T12:00:00Z',
        },
      ],
      pace_plans: [
        {
          id: 'pace-2',
          area_of_operation_id: 'ao-2',
          primary_plan: 'SATCOM net',
          alternate_plan: 'VHF relay',
          contingency_plan: 'Burst SMS',
          emergency_plan: 'HF voice',
          notes: 'Escalate after 3 missed check-ins.',
          created_by_id: 'user-1',
          updated_by_id: 'user-1',
          created_at: '2026-03-27T12:00:00Z',
          updated_at: '2026-03-27T12:00:00Z',
        },
      ],
    }

    renderPlanningPage()

    await user.selectOptions(screen.getAllByRole('combobox')[0], 'ao-2')

    await waitFor(() => {
      expect(screen.getByLabelText(/Intent title/i)).toHaveValue('Hold southern lanes')
      expect(screen.getByLabelText(/^Objective$/i)).toHaveValue('Maintain escort coverage.')
      expect(screen.getByLabelText(/End state/i)).toHaveValue('Commercial traffic moves without interruption.')
      expect(screen.getByLabelText(/Constraints/i)).toHaveValue('Avoid escalation near civilian traffic.')
      expect(screen.getByLabelText(/Primary/i)).toHaveValue('SATCOM net')
      expect(screen.getByLabelText(/Alternate/i)).toHaveValue('VHF relay')
      expect(screen.getByLabelText(/Contingency/i)).toHaveValue('Burst SMS')
      expect(screen.getByLabelText(/Emergency/i)).toHaveValue('HF voice')
      expect(screen.getByLabelText(/Notes/i, { selector: 'textarea#pace-notes' })).toHaveValue('Escalate after 3 missed check-ins.')
    })
  })

  it('submits a SALUTE report and resets the composer on success', async () => {
    const user = userEvent.setup()
    renderPlanningPage()

    await user.type(screen.getByLabelText(/^Size$/i), '2 fast boats')
    await user.type(screen.getByLabelText(/Activity/i), 'Shadowing patrol route')
    await user.type(screen.getByLabelText(/Location/i), 'Harbor ingress')
    await user.click(screen.getByRole('button', { name: /Submit SALUTE report/i }))

    await waitFor(() => {
      expect(planningState.createSaluteReport.mutateAsync).toHaveBeenCalled()
    })
    expect(screen.getByText(/SALUTE report submitted/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Activity/i)).toHaveValue('')
  })

  it('creates a chokepoint for the selected AO', async () => {
    const user = userEvent.setup()
    renderPlanningPage()

    await user.type(screen.getByLabelText(/^Name$/i), 'Hormuz East')
    await user.clear(screen.getByLabelText(/Latitude/i))
    await user.type(screen.getByLabelText(/Latitude/i), '25.285447')
    await user.clear(screen.getByLabelText(/Longitude/i))
    await user.type(screen.getByLabelText(/Longitude/i), '56.334457')
    await user.click(screen.getByRole('button', { name: /Create chokepoint/i }))

    await waitFor(() => {
      expect(planningState.createChokepoint.mutateAsync).toHaveBeenCalledWith({
        area_of_operation_id: 'ao-1',
        name: 'Hormuz East',
        category: 'strait',
        status: 'monitor',
        latitude: 25.285447,
        longitude: 56.334457,
        watch_radius_km: 25,
        notes: null,
      })
    })
    expect(screen.getByText(/Chokepoint created/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Update chokepoint/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Editing/i)).toHaveValue('cp-1')
  })

  it('shows a historical replay callout and disables write actions during replay', () => {
    planningState.isReplaying = true

    renderPlanningPage()

    expect(screen.getByText(/Viewing planning state as it existed at the replay timestamp/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save commander intent/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Save PACE plan/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Submit SALUTE report/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Create chokepoint/i })).toBeDisabled()
  })

  it('blocks operators from the planning surface', () => {
    planningState.isCommander = false

    renderPlanningPage()

    expect(screen.getByText(/Commander access required/i)).toBeInTheDocument()
  })
})
