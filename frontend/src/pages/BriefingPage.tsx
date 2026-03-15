import { Callout } from '@blueprintjs/core'
import BriefingPanel from '../components/BriefingPanel'
import { useAuth } from '../context/AuthContext'

export default function BriefingPage() {
  const { currentUser } = useAuth()
  const isCommander = currentUser?.role === 'commander'

  return (
    <div className="page-content">
      <div className="page-header">
        <h2 className="bp6-heading">Operational Briefing</h2>
        <span className="bp6-text-muted">AI-generated summaries grounded in audit data</span>
      </div>

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
