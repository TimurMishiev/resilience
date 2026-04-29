import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SourceHealthState } from '../hooks/useSourceHealth'

vi.mock('@blueprintjs/core', async () => {
  const actual = await vi.importActual<typeof import('@blueprintjs/core')>('@blueprintjs/core')
  const Tooltip = ({ children, content }: { children: ReactNode; content: ReactNode }) => (
    <div>
      <div data-testid="tooltip-content">{content}</div>
      {children}
    </div>
  )
  return { ...actual, Tooltip }
})

vi.mock('../components/ReplaySelector', () => ({
  default: () => <div data-testid="replay-selector" />,
}))

import { AppNavbar } from '../components/shell/AppNavbar'

function renderNavbar(sourceHealth: SourceHealthState) {
  render(
    <AppNavbar
      sourceHealth={sourceHealth}
      missionPosture="observe"
      hasMissionPosture={false}
      isCommander={true}
      userEmail="commander@resilience.test"
      userRole="commander"
      onSearchOpen={vi.fn()}
      onLogout={vi.fn()}
    />,
  )
}

describe('AppNavbar', () => {
  it('shows source-health detail behind the ambient freshness indicator', () => {
    renderNavbar({ aggregate: 'aging', sse: 'stale', data: 'aging' })

    expect(screen.getByTestId('source-health-indicator')).toHaveAttribute(
      'aria-label',
      'System freshness: Data may be delayed',
    )
    expect(screen.getByTestId('tooltip-content')).toHaveTextContent('System freshness')
    expect(screen.getByTestId('tooltip-content')).toHaveTextContent('Overall: Data may be delayed')
    expect(screen.getByTestId('tooltip-content')).toHaveTextContent('Event stream: Stale')
    expect(screen.getByTestId('tooltip-content')).toHaveTextContent('Data refresh: Delayed')
  })

  it('surfaces unavailable data explicitly in the tooltip detail', () => {
    renderNavbar({ aggregate: 'unavailable', sse: 'stale', data: 'unavailable' })

    expect(screen.getByTestId('tooltip-content')).toHaveTextContent('Overall: No data available')
    expect(screen.getByTestId('tooltip-content')).toHaveTextContent('Event stream: Stale')
    expect(screen.getByTestId('tooltip-content')).toHaveTextContent('Data refresh: Unavailable')
  })

  it('exposes the Sign out control via accessible name (a11y) and fires onLogout when activated', async () => {
    const onLogout = vi.fn()
    const user = userEvent.setup()
    render(
      <AppNavbar
        sourceHealth={{ aggregate: 'fresh', sse: 'fresh', data: 'fresh' }}
        missionPosture="observe"
        hasMissionPosture={false}
        isCommander={true}
        userEmail="commander@resilience.test"
        userRole="commander"
        onSearchOpen={vi.fn()}
        onLogout={onLogout}
      />,
    )

    // Screen readers and assistive tech locate this control by accessible name —
    // title="..." alone is only a hover tooltip. QA P3 (2026-04-29).
    const signOut = screen.getByRole('button', { name: /sign out/i })
    expect(signOut).toBeInTheDocument()

    await user.click(signOut)
    expect(onLogout).toHaveBeenCalledOnce()
  })
})
