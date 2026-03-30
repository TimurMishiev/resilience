import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PageErrorBoundary from '../components/PageErrorBoundary'

const capturePageRenderException = vi.hoisted(() => vi.fn())

vi.mock('../instrument', () => ({
  capturePageRenderException,
}))

function ThrowingPage(): never {
  throw new Error('boom')
}

describe('PageErrorBoundary', () => {
  beforeEach(() => {
    capturePageRenderException.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the fallback UI and reports the error', () => {
    render(
      <PageErrorBoundary pageName="Globe">
        <ThrowingPage />
      </PageErrorBoundary>
    )

    expect(screen.getByText('Globe failed to load')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(capturePageRenderException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom' }),
      expect.objectContaining({ componentStack: expect.any(String) }),
      'Globe'
    )
  })
})
