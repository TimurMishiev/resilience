import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'

const mockState = vi.hoisted(() => ({
  isReplaying: false,
  asOf: null as string | null,
  sites: [
    { id: 'site-1', name: 'Forward Site Alpha' },
    { id: 'site-2', name: 'Harbor Site Bravo' },
  ],
}))

const postAiSummary = vi.hoisted(() => vi.fn())
const exportBriefing = vi.hoisted(() => vi.fn())
const useSites = vi.hoisted(() => vi.fn())

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({
    isReplaying: mockState.isReplaying,
    asOf: mockState.asOf,
  }),
}))

vi.mock('../hooks/useSites', () => ({
  useSites: (...args: unknown[]) => {
    useSites(...args)
    return {
    data: { data: mockState.sites },
    }
  },
}))

vi.mock('../api/ai', () => ({
  postAiSummary,
  exportBriefing,
}))

import BriefingPanel from '../components/BriefingPanel'

describe('BriefingPanel', () => {
  beforeEach(() => {
    mockState.isReplaying = false
    mockState.asOf = null
    postAiSummary.mockReset()
    exportBriefing.mockReset()
    useSites.mockReset()
  })

  it('shows a replay warning and keeps the generate controls available during replay', () => {
    mockState.isReplaying = true

    render(<BriefingPanel />)

    expect(screen.getByText(/historical briefing snapshot anchored to the selected replay time/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Generate briefing/i })).toBeInTheDocument()
  })

  it('generates a site-scoped briefing and renders grounded output', async () => {
    const user = userEvent.setup()
    mockState.isReplaying = true
    mockState.asOf = '2026-03-26T21:30:00.000Z'
    postAiSummary.mockResolvedValue({
      data: {
        summary: 'Forward Site Alpha remains stable, with one alert requiring commander review.',
        citations: ['12345678-abcd-efgh'],
        context_counts: {
          audit_events: 2,
          signals: 1,
          rule_fires: 1,
        },
      },
    })

    render(<BriefingPanel />)

    await user.selectOptions(screen.getAllByRole('combobox')[0], 'site-1')
    await user.click(screen.getByRole('button', { name: /Generate briefing/i }))

    expect(postAiSummary).toHaveBeenCalledWith({
      summary_type: 'leadership_briefing',
      site_id: 'site-1',
      to: '2026-03-26T21:30:00.000Z',
    })

    expect(await screen.findByText(/Forward Site Alpha remains stable/i)).toBeInTheDocument()
    expect(screen.getByText(/Grounded in 4 records/i)).toBeInTheDocument()
    expect(screen.getByText(/Audit citations \(1\)/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Export PDF/i })).toBeInTheDocument()
  })

  it('loads the site selector from the replay cutoff during replay', () => {
    mockState.isReplaying = true
    mockState.asOf = '2026-03-26T21:30:00.000Z'

    render(<BriefingPanel />)

    expect(useSites).toHaveBeenCalledWith(
      { per_page: 100, as_of: '2026-03-26T21:30:00.000Z' },
      true,
    )
  })

  it('surfaces backend summary errors cleanly', async () => {
    const user = userEvent.setup()
    postAiSummary.mockRejectedValue(
      new ApiError(422, { errors: ['ANTHROPIC_API_KEY is not set'] }, 'API POST /api/ai/summary → 422'),
    )

    render(<BriefingPanel />)

    await user.click(screen.getByRole('button', { name: /Generate briefing/i }))

    expect(await screen.findByText('ANTHROPIC_API_KEY is not set')).toBeInTheDocument()
  })

  it('surfaces backend PDF export errors cleanly', async () => {
    const user = userEvent.setup()
    postAiSummary.mockResolvedValue({
      data: {
        summary: 'Executive briefing generated successfully.',
        citations: [],
        context_counts: {
          audit_events: 1,
          signals: 0,
          rule_fires: 0,
        },
      },
    })
    exportBriefing.mockRejectedValue(
      new ApiError(422, { errors: ['PDF generation failed: wkhtmltopdf missing'] }, 'API POST /api/ai/export → 422'),
    )

    render(<BriefingPanel />)

    await user.click(screen.getByRole('button', { name: /Generate briefing/i }))
    expect(await screen.findByText(/Executive briefing generated successfully/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Export PDF/i }))

    expect(await screen.findByText('PDF generation failed: wkhtmltopdf missing')).toBeInTheDocument()
  })

  it('shows the PDF export fallback only once when the backend returns no structured message', async () => {
    const user = userEvent.setup()
    postAiSummary.mockResolvedValue({
      data: {
        summary: 'Executive briefing generated successfully.',
        citations: [],
        context_counts: {
          audit_events: 1,
          signals: 0,
          rule_fires: 0,
        },
      },
    })
    exportBriefing.mockRejectedValue({})

    render(<BriefingPanel />)

    await user.click(screen.getByRole('button', { name: /Generate briefing/i }))
    expect(await screen.findByText(/Executive briefing generated successfully/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Export PDF/i }))

    expect(await screen.findByText(/^PDF export failed$/)).toBeInTheDocument()
  })
})
