import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRole = vi.hoisted(() => ({
  canViewOperationalHealth: true,
  isCommander: true,
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => mockRole,
}))

vi.mock('../pages/OperationalHealthPage', () => ({
  default: () => <div data-testid="operational-health-page">Operational health content</div>,
}))

import OperationalHealthRoutePage from '../pages/OperationalHealthRoutePage'

describe('OperationalHealthRoutePage', () => {
  beforeEach(() => {
    mockRole.canViewOperationalHealth = true
    mockRole.isCommander = true
  })

  it('renders the operational health page for commanders', () => {
    render(<OperationalHealthRoutePage />)

    expect(screen.getByTestId('operational-health-page')).toBeInTheDocument()
    expect(screen.queryByText(/commander access required/i)).not.toBeInTheDocument()
  })

  it('renders the access-denied callout without mounting the page for viewers', () => {
    mockRole.canViewOperationalHealth = false
    mockRole.isCommander = false

    render(<OperationalHealthRoutePage />)

    expect(screen.getByText(/commander access required/i)).toBeInTheDocument()
    expect(screen.queryByTestId('operational-health-page')).not.toBeInTheDocument()
  })
})
