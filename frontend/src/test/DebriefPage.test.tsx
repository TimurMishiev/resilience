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

vi.mock('../components/DebriefPanel', () => ({
  default: () => <div data-testid="debrief-panel">debrief-panel</div>,
}))

import DebriefPage from '../pages/DebriefPage'

describe('DebriefPage', () => {
  beforeEach(() => {
    roleState.isCommander = true
  })

  it('renders the debrief panel for commanders', () => {
    render(<DebriefPage />)

    expect(screen.getByRole('heading', { name: /Debrief/i })).toBeInTheDocument()
    expect(screen.getByTestId('debrief-panel')).toBeInTheDocument()
  })

  it('shows an access-denied callout for operators', () => {
    roleState.isCommander = false

    render(<DebriefPage />)

    expect(screen.getByText(/Commander access required/i)).toBeInTheDocument()
    expect(screen.queryByTestId('debrief-panel')).not.toBeInTheDocument()
  })
})
