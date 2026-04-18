import { Callout } from '@blueprintjs/core'
import DebriefPanel from '../components/DebriefPanel'
import { useRole } from '../hooks/useRole'

export default function DebriefPage() {
  const role = useRole()
  const canAccessDebrief = role.canAccessDebrief ?? role.isCommander

  return (
    <div className="page-content">
      <div className="page-header">
        <h2 className="bp6-heading">Debrief</h2>
        <span className="bp6-text-muted">
          Timeline of meaningful operational events across the organization
        </span>
      </div>

      {!canAccessDebrief ? (
        <Callout
          intent="warning"
          icon="lock"
          title="Commander access required"
          className="debrief-access-denied"
        >
          Debrief timelines aggregate audit history across the organization and are
          restricted to Commander-level accounts.
        </Callout>
      ) : (
        <DebriefPanel />
      )}
    </div>
  )
}
