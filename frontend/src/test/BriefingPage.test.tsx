import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const roleState = vi.hoisted(() => ({
  isCommander: true,
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => ({
    isCommander: roleState.isCommander,
  }),
}))

vi.mock('../components/BriefingPanel', () => ({
  default: () => <div data-testid="briefing-panel">briefing-panel</div>,
}))

import BriefingPage from '../pages/BriefingPage'

describe('BriefingPage', () => {
  beforeEach(() => {
    roleState.isCommander = true
  })

  it('renders the briefing panel for commanders', () => {
    render(<BriefingPage />)

    expect(screen.getByRole('heading', { name: /Operational Briefing/i })).toBeInTheDocument()
    expect(screen.getByTestId('briefing-panel')).toBeInTheDocument()
  })

  it('shows an access-denied callout for operators', () => {
    roleState.isCommander = false

    render(<BriefingPage />)

    expect(screen.getByText(/Commander access required/i)).toBeInTheDocument()
    expect(screen.queryByTestId('briefing-panel')).not.toBeInTheDocument()
  })
})
