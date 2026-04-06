import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const roleState = vi.hoisted(() => ({
  isCommander: true,
}))

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => ({ asOf: null, isReplaying: false }),
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => ({
    isCommander: roleState.isCommander,
  }),
}))

vi.mock('../components/OntologyQueryPanel', () => ({
  default: () => <div data-testid="ontology-query-panel">ontology-query-panel</div>,
}))

import OntologyQueryPage from '../pages/OntologyQueryPage'

describe('OntologyQueryPage', () => {
  beforeEach(() => {
    roleState.isCommander = true
  })

  it('renders the ontology query panel for commanders', () => {
    render(<OntologyQueryPage />)

    expect(screen.getByRole('heading', { name: /Ontology Query/i })).toBeInTheDocument()
    expect(screen.getByTestId('ontology-query-panel')).toBeInTheDocument()
  })

  it('shows an access-denied callout for operators', () => {
    roleState.isCommander = false

    render(<OntologyQueryPage />)

    expect(screen.getByText(/Commander access required/i)).toBeInTheDocument()
    expect(screen.queryByTestId('ontology-query-panel')).not.toBeInTheDocument()
  })
})
