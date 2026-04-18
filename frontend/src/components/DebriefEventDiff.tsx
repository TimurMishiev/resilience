import { Classes, Drawer, DrawerSize, Tag } from '@blueprintjs/core'
import type { AuditEvent } from '../api/types'
import { humanize } from '../utils/humanize'
import { diffSnapshots } from '../utils/diffSnapshots'
import SnapshotDiffView from './SnapshotDiffView'

interface DebriefEventDiffProps {
  event: AuditEvent | null
  onClose: () => void
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function DebriefEventDiff({ event, onClose }: DebriefEventDiffProps) {
  const diff = event ? diffSnapshots(event.before_snapshot, event.after_snapshot) : null

  return (
    <Drawer
      isOpen={!!event}
      onClose={onClose}
      size={DrawerSize.SMALL}
      position="right"
      title={event ? `${event.entity_type} changes` : 'Event changes'}
      icon="comparison"
      className="debrief-diff-drawer"
    >
      {event && diff && (
        <div className={Classes.DRAWER_BODY} style={{ padding: '16px 20px' }}>
          <div className="debrief-diff-meta">
            <Tag minimal intent="primary" className="debrief-entity-tag">
              {event.entity_type}
            </Tag>
            <Tag minimal>{humanize(event.action ?? event.event_type)}</Tag>
            <span className="bp6-text-muted debrief-diff-timestamp">
              {formatTime(event.occurred_at)} · {event.actor}
            </span>
          </div>
          <SnapshotDiffView
            diff={diff}
            emptyDescription="This event did not alter any stored fields between its before and after snapshots."
          />
        </div>
      )}
    </Drawer>
  )
}
