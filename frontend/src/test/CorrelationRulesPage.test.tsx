import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CorrelationRule } from '../api/types'

const mockState = vi.hoisted(() => ({
  isCommander: true,
  isReplaying: false,
  rules: [] as CorrelationRule[],
  createRule: { mutateAsync: vi.fn(async () => ({})), isPending: false },
  updateRule: { mutateAsync: vi.fn(async () => ({})), isPending: false },
  deleteRule: { mutateAsync: vi.fn(async () => undefined), isPending: false },
  effectiveness: {} as Record<string, { fire_count: number; last_fired_at: string | null }>,
  matches: { data: [] as unknown[], meta: { total: 0, page: 1, per_page: 25, total_pages: 1 } },
  areasOfOperation: [] as Array<{ id: string; name: string; posture: string }>,
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => ({ isCommander: mockState.isCommander }),
}))

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({ isReplaying: mockState.isReplaying, asOf: null }),
}))

vi.mock('../hooks/useCorrelationRules', () => ({
  useCorrelationRules: () => ({ data: { data: mockState.rules }, isPending: false, error: null }),
  useCreateCorrelationRule: () => mockState.createRule,
  useUpdateCorrelationRule: () => mockState.updateRule,
  useDeleteCorrelationRule: () => mockState.deleteRule,
  useRuleEffectiveness: () => ({ data: mockState.effectiveness }),
}))

vi.mock('../hooks/useSignalRuleMatches', () => ({
  useSignalRuleMatches: () => ({ data: mockState.matches, isPending: false }),
}))

vi.mock('../hooks/useAreasOfOperation', () => ({
  useAreasOfOperation: () => ({ data: { data: mockState.areasOfOperation }, isPending: false }),
}))

vi.mock('../api/correlation_rules', () => ({
  dryRunRule: vi.fn(async () => ({ fired_count: 0, matched_sites: [] })),
}))

vi.mock('../components/RuleSparkline', () => ({
  RuleSparkline: () => null,
}))

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  )
}

async function renderPage() {
  const { default: CorrelationRulesPage } = await import('../pages/CorrelationRulesPage')
  return render(<CorrelationRulesPage />, { wrapper: wrapper() })
}

beforeEach(() => {
  mockState.isCommander = true
  mockState.isReplaying = false
  mockState.rules = []
  mockState.createRule.mutateAsync = vi.fn(async () => ({}))
  mockState.updateRule.mutateAsync = vi.fn(async () => ({}))
  mockState.deleteRule.mutateAsync = vi.fn(async () => undefined)
})

describe('CorrelationRulesPage', () => {
  it('renders the page heading', async () => {
    await renderPage()
    expect(screen.getByText(/correlation rules/i)).toBeTruthy()
  })

  it('shows "0 rules" count when no rules exist', async () => {
    await renderPage()
    await waitFor(() => {
      expect(screen.getByText(/0 rules/i)).toBeTruthy()
    })
  })

  it('renders existing rules in the table', async () => {
    mockState.rules = [
      {
        id:                  'rule-1',
        name:                'Seismic Watch',
        description:         'Watches for seismic events',
        is_active:           true,
        conditions:          { signal_type: 'seismic_event', proximity_km: 100, count_threshold: 1, time_window_minutes: 30 },
        actions: {
          create_task: {
            title:       'Seismic task',
            description: 'Check infrastructure',
            priority:    'high',
          },
        },
        created_by:          'user-1',
        cooldown_minutes:    60,
        last_fired_at:       null,
        mitre_tags:          [],
        area_of_operation_id: null,
        created_at:          '2026-03-01T00:00:00Z',
        updated_at:          '2026-03-01T00:00:00Z',
      },
    ]

    await renderPage()
    await waitFor(() => {
      expect(screen.getByText('Seismic Watch')).toBeTruthy()
    })
  })

  it('shows replay warning when replaying', async () => {
    mockState.isReplaying = true
    await renderPage()
    await waitFor(() => {
      expect(screen.getByText(/correlation rules unavailable in replay/i)).toBeTruthy()
    })
  })

  it('hides create button for non-commanders', async () => {
    mockState.isCommander = false
    await renderPage()
    // Commander-only "New Rule" button should not be present
    expect(screen.queryByRole('button', { name: /new rule/i })).toBeNull()
  })
})
