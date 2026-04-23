import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

// DebriefPanel is covered by its own spec; here we only need to assert the
// wrapper's contract — role gating + collapse/expand — and that the expanded
// body contains the DebriefPanel with noNavigate threaded through. Mocking
// DebriefPanel keeps this test free of useQuery / ReplayContext / router
// wiring that the wrapper doesn't own.
vi.mock('../components/DebriefPanel', () => ({
  default: ({ noNavigate }: { noNavigate?: boolean }) => (
    <div data-testid="mock-debrief-panel" data-no-navigate={noNavigate ? 'true' : 'false'}>
      mock debrief
    </div>
  ),
}))

const roleState = vi.hoisted(() => ({
  value: {
    role: 'commander',
    isAdmin: false,
    isCommander: true,
    isOperator: false,
    isViewer: false,
    canAccessDebrief: true,
  } as Record<string, unknown>,
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => roleState.value,
}))

import { MapInlineDebriefPanel } from '../components/map/MapInlineDebriefPanel'

describe('MapInlineDebriefPanel', () => {
  it('does not render anything when the user cannot access debrief', () => {
    roleState.value = {
      role: 'viewer',
      isAdmin: false,
      isCommander: false,
      isOperator: false,
      isViewer: true,
      canAccessDebrief: false,
    }
    const { container } = render(<MapInlineDebriefPanel />)
    expect(container.firstChild).toBeNull()
  })

  it('renders toggle but no body when expanded is false (default)', () => {
    roleState.value = {
      role: 'commander',
      isAdmin: false,
      isCommander: true,
      isOperator: false,
      isViewer: false,
      canAccessDebrief: true,
    }
    render(<MapInlineDebriefPanel />)
    expect(screen.getByTestId('map-inline-debrief-toggle')).toBeInTheDocument()
    expect(screen.queryByTestId('map-inline-debrief-body')).toBeNull()
  })

  it('expands to render DebriefPanel with noNavigate=true on click', async () => {
    roleState.value = {
      role: 'commander',
      isAdmin: false,
      isCommander: true,
      isOperator: false,
      isViewer: false,
      canAccessDebrief: true,
    }
    const user = userEvent.setup()
    render(<MapInlineDebriefPanel />)

    await user.click(screen.getByTestId('map-inline-debrief-toggle'))

    const body = screen.getByTestId('map-inline-debrief-body')
    expect(body).toBeInTheDocument()
    const panel = screen.getByTestId('mock-debrief-panel')
    // Critical visual-contract assertion: noNavigate is threaded through, so
    // clicks inside the inline debrief enter replay but don't redirect away.
    expect(panel.getAttribute('data-no-navigate')).toBe('true')
  })

  it('collapses back when toggle is clicked a second time', async () => {
    roleState.value = {
      role: 'commander',
      isAdmin: false,
      isCommander: true,
      isOperator: false,
      isViewer: false,
      canAccessDebrief: true,
    }
    const user = userEvent.setup()
    render(<MapInlineDebriefPanel />)

    const toggle = screen.getByTestId('map-inline-debrief-toggle')
    await user.click(toggle)
    expect(screen.getByTestId('map-inline-debrief-body')).toBeInTheDocument()

    await user.click(toggle)
    expect(screen.queryByTestId('map-inline-debrief-body')).toBeNull()
  })
})
