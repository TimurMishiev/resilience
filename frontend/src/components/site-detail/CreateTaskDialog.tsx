import { useState } from 'react'
import {
  Button, Callout, Dialog, DialogBody, DialogFooter,
  FormGroup, HTMLSelect, InputGroup, TextArea,
} from '@blueprintjs/core'
import { useCreateTask } from '../../hooks/useTasks'
import { useAssets } from '../../hooks/useAssets'
import type { TaskPriority } from '../../api/types'

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'low',      label: 'Low' },
  { value: 'normal',   label: 'Normal' },
  { value: 'high',     label: 'High' },
  { value: 'critical', label: 'Critical' },
]

export default function CreateTaskDialog({ siteId, isOpen, onClose }: { siteId: string; isOpen: boolean; onClose: () => void }) {
  const [title, setTitle]         = useState('')
  const [description, setDesc]    = useState('')
  const [priority, setPriority]   = useState<TaskPriority>('normal')
  const [assetId, setAssetId]     = useState<string>('')
  const [error, setError]         = useState<string | null>(null)
  const { mutate, isPending }     = useCreateTask()
  const { data: assetRes }        = useAssets({ per_page: 200 })
  const assets                    = assetRes?.data ?? []

  function handleSubmit() {
    if (!title.trim()) { setError('Title is required'); return }
    setError(null)
    mutate(
      {
        site_id:     siteId,
        title:       title.trim(),
        description: description.trim() || undefined,
        priority,
        asset_id:    assetId || undefined,
      },
      {
        onSuccess: () => { onClose(); setTitle(''); setDesc(''); setPriority('normal'); setAssetId('') },
        onError: (e: Error) => setError(e.message),
      }
    )
  }

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="New Task" style={{ width: 440 }}>
      <DialogBody>
        {error && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{error}</Callout>}
        <FormGroup label="Title" labelFor="ct-title" labelInfo="(required)">
          <InputGroup
            id="ct-title"
            placeholder="e.g. Investigate GPS jamming near sector 4"
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
          />
        </FormGroup>
        <FormGroup label="Description" labelFor="ct-desc">
          <TextArea
            id="ct-desc"
            fill
            rows={3}
            placeholder="Optional — additional context or instructions"
            value={description}
            onChange={e => setDesc(e.target.value)}
          />
        </FormGroup>
        <FormGroup label="Priority" labelFor="ct-priority">
          <HTMLSelect
            id="ct-priority"
            value={priority}
            onChange={e => setPriority(e.target.value as TaskPriority)}
            fill
          >
            {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </HTMLSelect>
        </FormGroup>
        <FormGroup label="Assign Asset" labelFor="ct-asset">
          <HTMLSelect
            id="ct-asset"
            value={assetId}
            onChange={e => setAssetId(e.target.value)}
            fill
          >
            <option value="">— Unassigned —</option>
            {assets.map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.status})</option>
            ))}
          </HTMLSelect>
        </FormGroup>
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button intent="primary" onClick={handleSubmit} loading={isPending}>Create Task</Button>
          </>
        }
      />
    </Dialog>
  )
}
