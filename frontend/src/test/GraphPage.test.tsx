import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  sites:  { data: { data: [] }, isLoading: false, error: null as Error | null },
  tasks:  { data: { data: [] }, isLoading: false, error: null as Error | null },
  assets: { data: { data: [] }, isLoading: false, error: null as Error | null },
}))

vi.mock('../hooks/useSites', () => ({
  useSites: () => mockState.sites,
}))
vi.mock('../hooks/useTasks', () => ({
  useTasks: () => mockState.tasks,
}))
vi.mock('../hooks/useAssets', () => ({
  useAssets: () => mockState.assets,
}))
vi.mock('../hooks/useReplayParams', () => ({
  useReplayParams: () => ({ asOfParam: {} }),
}))

import GraphPage from '../pages/GraphPage'

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GraphPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('GraphPage', () => {
  it('renders toolbar with title and filter buttons', () => {
    renderPage()

    expect(screen.getByText('Object Graph')).toBeInTheDocument()
    expect(screen.getByText('Sites')).toBeInTheDocument()
    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.getByText('Assets')).toBeInTheDocument()
  })

  it('shows loading spinner while data loads', () => {
    mockState.sites = { data: { data: [] }, isLoading: true, error: null }

    renderPage()

    expect(document.querySelector('.graph-loading')).toBeInTheDocument()

    mockState.sites = { data: { data: [] }, isLoading: false, error: null }
  })

  it('shows error callout on fetch failure', () => {
    mockState.sites = { data: { data: [] }, isLoading: false, error: { message: 'Network error' } as Error }

    renderPage()

    expect(screen.getByText('Network error')).toBeInTheDocument()

    mockState.sites = { data: { data: [] }, isLoading: false, error: null }
  })
})
