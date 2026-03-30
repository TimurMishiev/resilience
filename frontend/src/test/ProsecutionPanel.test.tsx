import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProsecutionPanel from '../components/ProsecutionPanel'
import type { Incident } from '../api/incidents'

// ── shared mocks ──────────────────────────────────────────────────────────────

const mockRole = vi.hoisted(() => ({ isCommander: false }))
const mockReplay = vi.hoisted(() => ({ isReplaying: false }))

const mockHooks = vi.hoisted(() => ({
  steps: [] as unknown[],
  isPending: false,
  initiateMutate: vi.fn(),
  addStepMutate: vi.fn(),
}))

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({ isReplaying: mockReplay.isReplaying }),
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => ({ isCommander: mockRole.isCommander }),
}))

vi.mock('../hooks/useIncidents', () => ({
  useProsecutionSteps: () => ({
    data:       mockHooks.steps,
    isPending:  mockHooks.isPending,
    error:      null,
  }),
  useInitiateProsecution: () => ({
    mutate:    mockHooks.initiateMutate,
    isPending: false,
    isError:   false,
  }),
  useAddProsecutionStep: () => ({
    mutate:    mockHooks.addStepMutate,
    isPending: false,
    isError:   false,
  }),
}))

// ── helpers ───────────────────────────────────────────────────────────────────

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id:                        'inc-1',
    title:                     'Test Incident',
    description:               null,
    status:                    'open',
    severity:                  'high',
    confidence:                0.8,
    opened_at:                 '2026-03-29T10:00:00Z',
    acknowledged_at:           null,
    closed_at:                 null,
    fusion_rationale:          null,
    alert_count:               2,
    task_count:                1,
    assigned_to:               null,
    assigned_at:               null,
    site:                      null,
    area_of_operation:         null,
    prosecution_phase:         null,
    prosecution_initiated_at:  null,
    prosecuted_by:             null,
    created_at:                '2026-03-29T10:00:00Z',
    updated_at:                '2026-03-29T10:00:00Z',
    ...overrides,
  }
}

function renderPanel(incident: Incident) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ProsecutionPanel incident={incident} />
    </QueryClientProvider>
  )
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ProsecutionPanel', () => {
  beforeEach(() => {
    mockRole.isCommander    = false
    mockReplay.isReplaying  = false
    mockHooks.steps         = []
    mockHooks.isPending     = false
    mockHooks.initiateMutate.mockReset()
    mockHooks.addStepMutate.mockReset()
  })

  it('shows replay callout and nothing else when in replay mode', () => {
    mockReplay.isReplaying = true
    renderPanel(makeIncident())

    expect(screen.getByText(/unavailable during replay/i)).toBeInTheDocument()
    expect(screen.queryByText(/not being prosecuted/i)).not.toBeInTheDocument()
  })

  it('shows NonIdealState with initiate button for commanders when not prosecuted', () => {
    mockRole.isCommander = true
    renderPanel(makeIncident({ prosecution_phase: null }))

    expect(screen.getByText(/not being prosecuted/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /initiate prosecution/i })).toBeInTheDocument()
  })

  it('does NOT show initiate button for operators when not prosecuted', () => {
    mockRole.isCommander = false
    renderPanel(makeIncident({ prosecution_phase: null }))

    expect(screen.getByText(/not being prosecuted/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /initiate prosecution/i })).not.toBeInTheDocument()
  })

  it('calls initiateProsecution mutation when Initiate button is clicked', () => {
    mockRole.isCommander = true
    renderPanel(makeIncident({ prosecution_phase: null }))

    fireEvent.click(screen.getByRole('button', { name: /initiate prosecution/i }))
    expect(mockHooks.initiateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inc-1' }),
      expect.anything()
    )
  })

  it('renders phase track when incident is being prosecuted', () => {
    renderPanel(makeIncident({ prosecution_phase: 'assessing' }))

    expect(screen.getByText('PROSECUTION PHASE')).toBeInTheDocument()
    expect(screen.getAllByText('Assessing').length).toBeGreaterThan(0)
    expect(screen.queryByText(/not being prosecuted/i)).not.toBeInTheDocument()
  })

  it('shows Advance Phase button for commanders on active prosecution', () => {
    mockRole.isCommander = true
    renderPanel(makeIncident({ prosecution_phase: 'assessing' }))

    expect(screen.getByRole('button', { name: /advance.*executing/i })).toBeInTheDocument()
  })

  it('does NOT show Advance Phase button for operators', () => {
    mockRole.isCommander = false
    renderPanel(makeIncident({ prosecution_phase: 'assessing' }))

    expect(screen.queryByRole('button', { name: /advance/i })).not.toBeInTheDocument()
  })

  it('does NOT show commander action buttons when phase is concluded', () => {
    mockRole.isCommander = true
    renderPanel(makeIncident({ prosecution_phase: 'concluded' }))

    expect(screen.queryByRole('button', { name: /advance/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add step/i })).not.toBeInTheDocument()
  })

  it('renders prosecution log with step notes when steps are present', () => {
    mockHooks.steps = [
      {
        id:            'step-1',
        incident_id:   'inc-1',
        actor:         { id: 'u-1', email: 'cmd@test.com' },
        phase:         'assessing',
        action_type:   'phase_transition',
        notes:         'Started formal prosecution',
        evidence_refs: {},
        occurred_at:   '2026-03-29T10:05:00Z',
        created_at:    '2026-03-29T10:05:00Z',
      },
    ]
    renderPanel(makeIncident({ prosecution_phase: 'assessing' }))

    expect(screen.getByText('Started formal prosecution')).toBeInTheDocument()
    expect(screen.getByText(/cmd@test\.com/)).toBeInTheDocument()
  })

  it('input does not freeze during re-renders — isEditing gate not broken', async () => {
    mockRole.isCommander = true
    renderPanel(makeIncident({ prosecution_phase: 'assessing' }))

    // Open the add-step form
    fireEvent.click(screen.getByRole('button', { name: /add step/i }))

    const textarea = screen.getByPlaceholderText(/notes/i)
    fireEvent.change(textarea, { target: { value: 'My typed note' } })

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('My typed note')
    })
  })
})
