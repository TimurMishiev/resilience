import { Callout, HTMLTable, NonIdealState, Spinner, Tag } from '@blueprintjs/core'
import { useTasks } from '../../hooks/useTasks'
import { humanize } from '../../utils/humanize'
import type { Task } from '../../api/types'

const PRIORITY_INTENT: Record<string, 'danger' | 'warning' | 'primary' | 'none'> = {
  critical: 'danger', high: 'warning', normal: 'primary', low: 'none',
}

const STATUS_INTENT: Record<string, 'success' | 'warning' | 'danger' | 'none' | 'primary'> = {
  resolved: 'success', blocked: 'danger', in_progress: 'primary', triaged: 'warning', new: 'none',
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function SiteTasksTab({ siteId, asOf, onSelect }: { siteId: string; asOf?: string | null; onSelect: (task: Task) => void }) {
  const { data, isPending, error } = useTasks({ site_id: siteId, per_page: 50, ...(asOf ? { as_of: asOf } : {}) })

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (error) return <Callout intent="danger" compact>{error.message}</Callout>

  const tasks = data?.data ?? []

  if (tasks.length === 0) {
    return (
      <NonIdealState
        icon="tick-circle"
        title="No tasks"
        description="No tasks linked to this site."
        className="tab-empty-state"
      />
    )
  }

  return (
    <HTMLTable className="data-table" striped interactive>
      <thead>
        <tr>
          <th>Title</th>
          <th>Priority</th>
          <th>Status</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t: Task) => (
          <tr key={t.id} onClick={() => onSelect(t)} className="clickable-row">
            <td>{t.title}</td>
            <td>
              <Tag minimal intent={PRIORITY_INTENT[t.priority] ?? 'none'}>
                {t.priority}
              </Tag>
            </td>
            <td>
              <Tag minimal intent={STATUS_INTENT[t.workflow_status] ?? 'none'}>
                {humanize(t.workflow_status)}
              </Tag>
            </td>
            <td className="mono">{fmt(t.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}
