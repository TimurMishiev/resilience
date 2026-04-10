import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateExport = vi.hoisted(() => vi.fn())

vi.mock('../api/exports', () => ({
  createExport: (...args: unknown[]) => mockCreateExport(...args),
}))

async function renderDialog(isOpen = true) {
  const onClose = vi.fn()
  await act(async () => {
    const { default: ExportDialog } = await import('../components/ExportDialog')
    render(<ExportDialog isOpen={isOpen} onClose={onClose} />)
  })
  return { onClose }
}

describe('ExportDialog', () => {
  beforeEach(() => {
    mockCreateExport.mockReset()
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
    globalThis.URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders form fields when open', async () => {
    await renderDialog()

    expect(screen.getByLabelText('Entity Type')).toBeInTheDocument()
    expect(screen.getByLabelText('Format')).toBeInTheDocument()
    expect(screen.getByText('Export')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('does not render when closed', async () => {
    await renderDialog(false)

    expect(screen.queryByLabelText('Entity Type')).not.toBeInTheDocument()
  })

  it('calls createExport on submit and triggers download', async () => {
    const blob = new Blob(['test,data'], { type: 'text/csv' })
    mockCreateExport.mockResolvedValue(blob)
    const user = userEvent.setup()

    const { onClose } = await renderDialog()

    await user.click(screen.getByText('Export'))

    expect(mockCreateExport).toHaveBeenCalledWith({
      entity_type: 'signals',
      format: 'csv',
      from: undefined,
      to: undefined,
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('shows error callout on failure', async () => {
    mockCreateExport.mockRejectedValue(new Error('Export limit exceeded'))
    const user = userEvent.setup()

    await renderDialog()

    await user.click(screen.getByText('Export'))

    expect(await screen.findByText('Export limit exceeded')).toBeInTheDocument()
  })

  it('allows changing entity type and format', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' })
    mockCreateExport.mockResolvedValue(blob)
    const user = userEvent.setup()

    await renderDialog()

    await user.selectOptions(screen.getByLabelText('Entity Type'), 'incidents')
    await user.selectOptions(screen.getByLabelText('Format'), 'json')
    await user.click(screen.getByText('Export'))

    expect(mockCreateExport).toHaveBeenCalledWith({
      entity_type: 'incidents',
      format: 'json',
      from: undefined,
      to: undefined,
    })
  })
})
