import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  planning: {
    tasks: [],
    assets: [],
    areas_of_operation: [
      { id: 'ao-1', name: 'North Gulf', posture: 'defensive' },
    ],
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
      salute_report_meta_by_ao: { 'ao-1': { truncated: false, count: 0 } },
    },
  },
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
    planningState.planning = {
      tasks: [],
      assets: [],
      areas_of_operation: [
        { id: 'ao-1', name: 'North Gulf', posture: 'defensive' },
      ],
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
    expect(screen.getByRole('button', { name: /Save commander intent/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save PACE plan/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Submit SALUTE report/i })).toBeInTheDocument()
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

  it('blocks operators from the planning surface', () => {
    planningState.isCommander = false

    renderPlanningPage()

    expect(screen.getByText(/Commander access required/i)).toBeInTheDocument()
  })
})
