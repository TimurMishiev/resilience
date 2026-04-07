import { useState } from 'react'
import { Button, Menu, MenuItem, Popover, Spinner } from '@blueprintjs/core'
import { createExport, type ExportEntityType, type ExportFormat, type ExportFilters } from '../api/exports'
import { AppToaster } from '../lib/toaster'

interface Props {
  entityType: ExportEntityType
  filters?: ExportFilters
  label?: string
}

function triggerDownload(blob: Blob, entityType: string, format: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${entityType}-${new Date().toISOString().slice(0, 16).replace(':', '')}.${format}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function ExportButton({ entityType, filters, label }: Props) {
  const [loading, setLoading] = useState(false)

  async function handleExport(format: ExportFormat) {
    setLoading(true)
    try {
      const blob = await createExport({
        entity_type: entityType,
        format,
        ...filters,
      })
      triggerDownload(blob, entityType, format)
    } catch (e) {
      AppToaster.then(t => t.show({
        message: e instanceof Error ? e.message : 'Export failed',
        intent: 'danger',
        icon: 'error',
        timeout: 4000,
      }))
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <Button small disabled icon={<Spinner size={14} />} text="Exporting…" />
  }

  const menu = (
    <Menu>
      <MenuItem icon="document" text="Export CSV" onClick={() => handleExport('csv')} />
      <MenuItem icon="code" text="Export JSON" onClick={() => handleExport('json')} />
    </Menu>
  )

  return (
    <Popover content={menu} placement="bottom-end" minimal>
      <Button small icon="export" text={label ?? 'Export'} />
    </Popover>
  )
}
