import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateExport = vi.hoisted(() => vi.fn())
const mockToasterShow = vi.hoisted(() => vi.fn())

vi.mock('../api/exports', () => ({
  createExport: (...args: unknown[]) => mockCreateExport(...args),
}))

vi.mock('../lib/toaster', () => ({
  AppToaster: Promise.resolve({ show: mockToasterShow }),
}))

async function renderButton(props: { entityType?: string; filters?: Record<string, string> } = {}) {
  const { default: ExportButton } = await import('../components/ExportButton')
  render(
    <ExportButton
      entityType={(props.entityType ?? 'signals') as 'signals'}
      filters={props.filters}
    />,
  )
}

describe('ExportButton', () => {
  beforeEach(() => {
    mockCreateExport.mockReset()
    mockToasterShow.mockReset()
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
    globalThis.URL.revokeObjectURL = vi.fn()
  })

  it('renders an export button', async () => {
    await renderButton()
    expect(screen.getByText('Export')).toBeInTheDocument()
  })

  it('shows CSV and JSON options on click', async () => {
    const user = userEvent.setup()
    await renderButton()

    await user.click(screen.getByText('Export'))

    expect(screen.getByText('Export CSV')).toBeInTheDocument()
    expect(screen.getByText('Export JSON')).toBeInTheDocument()
  })

  it('calls createExport with CSV format and filters', async () => {
    const blob = new Blob(['test,data'], { type: 'text/csv' })
    mockCreateExport.mockResolvedValue(blob)
    const user = userEvent.setup()

    await renderButton({ entityType: 'incidents', filters: { status: 'open' } })

    await user.click(screen.getByText('Export'))
    await user.click(screen.getByText('Export CSV'))

    expect(mockCreateExport).toHaveBeenCalledWith({
      entity_type: 'incidents',
      format: 'csv',
      status: 'open',
    })
  })

  it('calls createExport with JSON format', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' })
    mockCreateExport.mockResolvedValue(blob)
    const user = userEvent.setup()

    await renderButton({ entityType: 'tasks' })

    await user.click(screen.getByText('Export'))
    await user.click(screen.getByText('Export JSON'))

    expect(mockCreateExport).toHaveBeenCalledWith({
      entity_type: 'tasks',
      format: 'json',
    })
  })

  it('shows loading state during export', async () => {
    let resolveExport!: (b: Blob) => void
    mockCreateExport.mockReturnValue(new Promise<Blob>((r) => { resolveExport = r }))
    const user = userEvent.setup()

    await renderButton()

    await user.click(screen.getByText('Export'))
    await user.click(screen.getByText('Export CSV'))

    expect(screen.getByText('Exporting…')).toBeInTheDocument()

    resolveExport(new Blob(['ok']))
    await waitFor(() => expect(screen.getByText('Export')).toBeInTheDocument())
  })

  it('shows error toast on failure', async () => {
    mockCreateExport.mockRejectedValue(new Error('Server error'))
    const user = userEvent.setup()

    await renderButton()

    await user.click(screen.getByText('Export'))
    await user.click(screen.getByText('Export CSV'))

    await waitFor(() => {
      expect(mockToasterShow).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Server error', intent: 'danger' }),
      )
    })
    // Button returns to normal after error
    expect(screen.getByText('Export')).toBeInTheDocument()
  })
})
