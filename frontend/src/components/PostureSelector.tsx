import { useState } from 'react'
import { Button, HTMLSelect, FormGroup } from '@blueprintjs/core'
import { useRole } from '../hooks/useRole'
import { useUpdateAreaOfOperationPosture } from '../hooks/useAreasOfOperation'
import { PostureBadge } from './PostureBadge'
import { POSTURE_LABELS } from '../utils/humanize'
import type { Posture, AreaOfOperation } from '../api/types'
import { POSTURES } from '../api/types'

interface Props {
  area: AreaOfOperation
}

export function PostureSelector({ area }: Props) {
  const { isCommander } = useRole()
  const [pending, setPending] = useState<Posture | null>(null)
  const mutation = useUpdateAreaOfOperationPosture()

  if (!isCommander) {
    return <PostureBadge posture={area.posture} />
  }

  function handleConfirm() {
    if (!pending || pending === area.posture) return
    mutation.mutate(
      { id: area.id, posture: pending },
      { onSuccess: () => setPending(null) }
    )
  }

  const selected = pending ?? area.posture

  return (
    <FormGroup label="ROE Posture" style={{ marginBottom: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <HTMLSelect
          value={selected}
          onChange={e => setPending(e.target.value as Posture)}
          disabled={mutation.isPending}
        >
          {POSTURES.map(p => (
            <option key={p} value={p}>{POSTURE_LABELS[p]}</option>
          ))}
        </HTMLSelect>

        {pending && pending !== area.posture && (
          <Button
            intent="danger"
            small
            loading={mutation.isPending}
            onClick={handleConfirm}
          >
            Confirm
          </Button>
        )}

        {!pending && <PostureBadge posture={area.posture} minimal={false} />}
      </div>
    </FormGroup>
  )
}
