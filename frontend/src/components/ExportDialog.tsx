import { useState } from 'react'
import {
  Button, Callout, Dialog, DialogBody, DialogFooter,
  FormGroup, HTMLSelect, InputGroup,
} from '@blueprintjs/core'
import { createExport, type ExportEntityType, type ExportFormat } from '../api/exports'

const ENTITY_TYPES: { value: ExportEntityType; label: string }[] = [
  { value: 'signals', label: 'Signals' },
  { value: 'incidents', label: 'Incidents' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'audit_events', label: 'Audit Events' },
  { value: 'sites', label: 'Sites' },
]

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
]

interface Props {
  isOpen: boolean
  onClose: () => void
}

export default function ExportDialog({ isOpen, onClose }: Props) {
  const [entityType, setEntityType] = useState<ExportEntityType>('signals')
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleClose() {
    setError(null)
    onClose()
  }

  async function handleExport() {
    setLoading(true)
    setError(null)
    try {
      const blob = await createExport({
        entity_type: entityType,
        format,
        from: from || undefined,
        to: to || undefined,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${entityType}-${new Date().toISOString().slice(0, 16).replace(':', '')}.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      handleClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog isOpen={isOpen} onClose={handleClose} title="Export Data" icon="export">
      <DialogBody>
        {error && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{error}</Callout>}
        <FormGroup label="Entity Type" labelFor="export-entity">
          <HTMLSelect
            id="export-entity"
            value={entityType}
            onChange={e => setEntityType(e.target.value as ExportEntityType)}
            fill
          >
            {ENTITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </HTMLSelect>
        </FormGroup>
        <FormGroup label="Format" labelFor="export-format">
          <HTMLSelect
            id="export-format"
            value={format}
            onChange={e => setFormat(e.target.value as ExportFormat)}
            fill
          >
            {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </HTMLSelect>
        </FormGroup>
        <FormGroup label="From (optional)" labelFor="export-from" helperText="ISO 8601 datetime, e.g. 2026-04-01T00:00:00Z">
          <InputGroup
            id="export-from"
            type="datetime-local"
            value={from}
            onChange={e => setFrom(e.target.value)}
            fill
          />
        </FormGroup>
        <FormGroup label="To (optional)" labelFor="export-to" helperText="Leave blank for current time">
          <InputGroup
            id="export-to"
            type="datetime-local"
            value={to}
            onChange={e => setTo(e.target.value)}
            fill
          />
        </FormGroup>
        <Callout intent="none" icon="info-sign" compact>
          Exports are capped at 10,000 rows. Use narrower time ranges for large datasets.
        </Callout>
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button text="Cancel" onClick={handleClose} />
            <Button intent="primary" text="Export" icon="export" loading={loading} onClick={handleExport} />
          </>
        }
      />
    </Dialog>
  )
}
