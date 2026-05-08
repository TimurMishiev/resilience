import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Recommendation, RecommendationMetrics } from '../api/recommendations'

const mockState = vi.hoisted(() => ({
  isReplaying: true,
  asOf: '2026-03-29T10:00:00Z' as string | null,
  role: 'commander' as 'commander' | 'operator' | 'viewer',
  params: null as Record<string, unknown> | null,
  options: null as { refetchInterval?: number | false } | null,
  metricsOptions: null as { enabled?: boolean; refetchInterval?: number | false } | null,
  metrics: {
    pending: 1,
    accepted: 0,
    rejected: 0,
    deferred: 0,
    executed: 0,
    expired: 0,
    accept_rate: null,
    by_tier: { rule: 1, llm: 0 },
    by_type: { create_task: 1 },
    ai_status: {
      api_key_configured: true,
      breaker_open: false,
      services_open: [],
    },
  } as RecommendationMetrics,
  recommendations: [
    {
      id: 'rec-1',
      recommendation_type: 'create_task',
      tier: 'rule',
      status: 'pending',
      confidence: 0.92,
      rationale: 'Escalate patrol response around Site Alpha.',
      evidence: [{ type: 'alert', id: 'match-1', detail: 'Alert linked to Site Alpha perimeter breach' }],
      action_payload: {},
      affected_entity_type: 'Site',
      affected_entity_id: 'site-1',
      expires_at: '2026-03-29T12:00:00Z',
      reviewed_by: null,
      reviewed_at: null,
      review_reason: null,
      executed_at: null,
      created_at: '2026-03-29T09:55:00Z',
    },
  ] satisfies Recommendation[],
}))

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({
    isReplaying: mockState.isReplaying,
    asOf: mockState.asOf,
  }),
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => ({
    role: mockState.role,
    isCommander: mockState.role === 'commander',
    isOperator: mockState.role === 'operator',
    isViewer: mockState.role === 'viewer',
  }),
}))

vi.mock('../hooks/useRecommendations', () => ({
  useRecommendations: (params?: Record<string, unknown>, options?: { refetchInterval?: number | false }) => {
    mockState.params = params ?? null
    mockState.options = options ?? null
    return {
      data: {
        data: mockState.recommendations,
        meta: { total: mockState.recommendations.length, page: 1, per_page: 50, total_pages: 1 },
      },
      isPending: false,
      error: null,
    }
  },
  useRecommendationMetrics: (options?: { enabled?: boolean; refetchInterval?: number | false }) => {
    mockState.metricsOptions = options ?? null
    return { data: mockState.metrics }
  },
  useGenerateRecommendations: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
}))

vi.mock('../components/RecommendationCard', () => ({
  default: ({
    rec,
    onViewEvidence,
  }: {
    rec: Recommendation
    onViewEvidence: (rec: Recommendation) => void
  }) => (
    <button type="button" onClick={() => onViewEvidence(rec)}>
      {rec.evidence.length} evidence item{rec.evidence.length !== 1 ? 's' : ''}
    </button>
  ),
}))

vi.mock('../components/EvidenceDrawer', () => ({
  default: ({
    rec,
  }: {
    rec: Recommendation | null
  }) => (rec ? <div>{`Evidence drawer: ${rec.evidence[0]?.detail}`}</div> : null),
}))

async function renderPage() {
  const { default: RecommendationsPage } = await import('../pages/RecommendationsPage')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/recommendations']}>
        <RecommendationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RecommendationsPage', () => {
  beforeEach(() => {
    mockState.isReplaying = true
    mockState.asOf = '2026-03-29T10:00:00Z'
    mockState.role = 'commander'
    mockState.params = null
    mockState.options = null
    mockState.metricsOptions = null
    mockState.metrics = {
      pending: 1,
      accepted: 0,
      rejected: 0,
      deferred: 0,
      executed: 0,
      expired: 0,
      accept_rate: null,
      by_tier: { rule: 1, llm: 0 },
      by_type: { create_task: 1 },
      ai_status: {
        api_key_configured: true,
        breaker_open: false,
        services_open: [],
      },
    } as RecommendationMetrics
  })

  it('opens evidence during replay and keeps polling disabled', async () => {
    const user = userEvent.setup()

    await renderPage()

    expect(screen.getByText(/showing recommendations as they existed at the replay timestamp/i)).toBeInTheDocument()
    expect(mockState.params).toMatchObject({ as_of: '2026-03-29T10:00:00Z' })
    expect(mockState.options).toMatchObject({ refetchInterval: false })
    expect(mockState.metricsOptions).toMatchObject({ enabled: false, refetchInterval: false })

    await user.click(screen.getByRole('button', { name: /1 evidence item/i }))

    expect(screen.getByText(/evidence drawer: alert linked to site alpha perimeter breach/i)).toBeInTheDocument()
  })

  it('uses active-only blank filter semantics in live mode', async () => {
    mockState.isReplaying = false
    mockState.asOf = null

    await renderPage()

    const activeOption = screen.getByRole('option', { name: 'Active (pending)' }) as HTMLOptionElement
    expect(activeOption.selected).toBe(true)
    expect(mockState.params).toEqual({})
    expect(mockState.options).toMatchObject({ refetchInterval: 60_000 })
    expect(mockState.metricsOptions).toMatchObject({ enabled: true, refetchInterval: 120_000 })
    expect(screen.getByText('1 active')).toBeInTheDocument()
  })

  it('explains that the Anthropic API key is not configured when AI metrics report no key', async () => {
    mockState.isReplaying = false
    mockState.asOf = null
    mockState.metrics.ai_status = {
      api_key_configured: false,
      breaker_open: false,
      services_open: [],
    }

    const user = userEvent.setup()
    await renderPage()
    await user.click(screen.getByRole('tab', { name: /ai-enriched/i }))

    expect(screen.getByText(/Anthropic API key is not configured/i)).toBeInTheDocument()
  })

  it('explains when the AI breaker is open and names the bypassed service', async () => {
    mockState.isReplaying = false
    mockState.asOf = null
    mockState.metrics.ai_status = {
      api_key_configured: true,
      breaker_open: true,
      services_open: ['recommendation_llm_enricher'],
    }

    const user = userEvent.setup()
    await renderPage()
    await user.click(screen.getByRole('tab', { name: /ai-enriched/i }))

    expect(screen.getByText(/circuit breaker is open for recommendation_llm_enricher/i)).toBeInTheDocument()
  })

  it('explains when the AI path is healthy but no items met the LLM threshold', async () => {
    mockState.isReplaying = false
    mockState.asOf = null
    mockState.metrics.ai_status = {
      api_key_configured: true,
      breaker_open: false,
      services_open: [],
    }

    const user = userEvent.setup()
    await renderPage()
    await user.click(screen.getByRole('tab', { name: /ai-enriched/i }))

    expect(screen.getByText(/No items met the LLM threshold this cycle/i)).toBeInTheDocument()
  })
})
