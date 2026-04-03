import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'

const replayState = vi.hoisted(() => ({
  isReplaying: false,
  asOf: '2026-04-02T12:00:00Z',
}))

const postAiOntologyQuery = vi.hoisted(() => vi.fn())

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({
    isReplaying: replayState.isReplaying,
    asOf: replayState.asOf,
  }),
}))

vi.mock('../api/ai', () => ({
  postAiOntologyQuery,
}))

import OntologyQueryPanel from '../components/OntologyQueryPanel'

describe('OntologyQueryPanel', () => {
  beforeEach(() => {
    replayState.isReplaying = false
    postAiOntologyQuery.mockReset()
  })

  it('shows a historical replay banner during replay but keeps query controls accessible', () => {
    replayState.isReplaying = true

    render(<OntologyQueryPanel />)

    expect(screen.getByText(/operational graph as it existed at the replay timestamp/i)).toBeInTheDocument()
    // Query controls should still be visible (not hard-gated)
    expect(screen.getByRole('button', { name: /Run ontology query/i })).toBeInTheDocument()
  })

  it('submits the natural-language query and renders the graph response', async () => {
    const user = userEvent.setup()
    postAiOntologyQuery.mockResolvedValue({
      data: {
        original_query: 'show incidents and alerts connected to Forward Site Alpha',
        summary: 'Resolved Forward Site Alpha as the focal site.',
        normalized_query: {
          root_type: 'site',
          root_id: 'site-1',
          root_label: 'Forward Site Alpha',
          relations: ['incidents', 'alerts', 'recommendations'],
          time_window_hours: 72,
          limit: 8,
        },
        nodes: [
          {
            id: 'site:site-1',
            entity_id: 'site-1',
            type: 'site',
            label: 'Forward Site Alpha',
            sublabel: 'Site · active',
            root: true,
            metadata: { status: 'active' },
          },
          {
            id: 'incident:inc-1',
            entity_id: 'inc-1',
            type: 'incident',
            label: 'Harbor breach watch',
            sublabel: 'Incident · high · open',
            root: false,
            metadata: { severity: 'high', status: 'open' },
          },
        ],
        edges: [
          { source: 'site:site-1', target: 'incident:inc-1', relation: 'site_incident' },
        ],
        counts: {
          node_count: 2,
          edge_count: 1,
          by_type: { site: 1, incident: 1 },
        },
      },
    })

    render(<OntologyQueryPanel />)

    await user.type(screen.getByPlaceholderText(/show incidents, alerts, tasks/i), 'show incidents and alerts connected to Forward Site Alpha')
    await user.click(screen.getByRole('button', { name: /Run ontology query/i }))

    expect(postAiOntologyQuery).toHaveBeenCalledWith({
      q: 'show incidents and alerts connected to Forward Site Alpha',
    })
    expect(await screen.findByText(/Resolved Forward Site Alpha as the focal site/i)).toBeInTheDocument()
    expect(screen.getByText(/Forward Site Alpha → Harbor breach watch/i)).toBeInTheDocument()
    expect(screen.getByText(/^Root$/i)).toBeInTheDocument()
  })

  it('submits the replay cutoff with ontology queries during replay', async () => {
    const user = userEvent.setup()
    replayState.isReplaying = true
    postAiOntologyQuery.mockResolvedValue({
      data: {
        original_query: 'show incidents connected to Forward Site Alpha',
        summary: 'Resolved Forward Site Alpha as the focal site.',
        normalized_query: {
          root_type: 'site',
          root_id: 'site-1',
          root_label: 'Forward Site Alpha',
          relations: ['incidents'],
          time_window_hours: 72,
          limit: 8,
          as_of: replayState.asOf,
        },
        nodes: [],
        edges: [],
        counts: {
          node_count: 0,
          edge_count: 0,
          by_type: {},
        },
      },
    })

    render(<OntologyQueryPanel />)

    await user.type(screen.getByPlaceholderText(/show incidents, alerts, tasks/i), 'show incidents connected to Forward Site Alpha')
    await user.click(screen.getByRole('button', { name: /Run ontology query/i }))

    expect(postAiOntologyQuery).toHaveBeenCalledWith({
      q: 'show incidents connected to Forward Site Alpha',
      as_of: replayState.asOf,
    })
  })

  it('surfaces backend ontology errors cleanly', async () => {
    const user = userEvent.setup()
    postAiOntologyQuery.mockRejectedValue(
      new ApiError(422, { errors: ["No site matched 'phantom base'"] }, 'API POST /api/ai/ontology_query → 422'),
    )

    render(<OntologyQueryPanel />)

    await user.type(screen.getByPlaceholderText(/show incidents, alerts, tasks/i), 'phantom base')
    await user.click(screen.getByRole('button', { name: /Run ontology query/i }))

    expect(await screen.findByText("No site matched 'phantom base'")).toBeInTheDocument()
  })
})
