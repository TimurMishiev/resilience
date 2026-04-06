import { Callout } from '@blueprintjs/core'
import BriefingPanel from '../components/BriefingPanel'
import { useReplay } from '../context/ReplayContext'
import { useRole } from '../hooks/useRole'

export default function BriefingPage() {
  const { isCommander } = useRole()
  const { isReplaying } = useReplay()

  return (
    <div className="page-content">
      <div className="page-header">
        <h2 className="bp6-heading">Operational Briefing</h2>
        <span className="bp6-text-muted">AI-generated summaries grounded in audit events, intelligence signals, and rule fires</span>
      </div>

      {isReplaying && (
        <Callout intent="warning" icon="history" style={{ marginBottom: 16 }}>
          Replay mode — AI briefings reflect current operational state, not the replay timestamp.
        </Callout>
      )}

      {!isCommander ? (
        <Callout
          intent="warning"
          icon="lock"
          title="Commander access required"
          className="briefing-access-denied"
        >
          Operational briefings contain sensitive AI-synthesised assessments and are
          restricted to Commander-level accounts. Contact your commander to request
          a summary.
        </Callout>
      ) : (
        <BriefingPanel />
      )}
    </div>
  )
}
