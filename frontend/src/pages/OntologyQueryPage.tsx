import { Callout } from '@blueprintjs/core'
import OntologyQueryPanel from '../components/OntologyQueryPanel'
import { useReplay } from '../context/ReplayContext'
import { useRole } from '../hooks/useRole'

export default function OntologyQueryPage() {
  const { isCommander } = useRole()
  const { isReplaying } = useReplay()

  return (
    <div className="page-content ontology-page">
      <div className="page-header">
        <h2 className="bp6-heading">Ontology Query</h2>
        <span className="bp6-text-muted">Commander-only natural-language traversal across the operational entity graph</span>
      </div>

      {isReplaying && (
        <Callout intent="warning" icon="history" style={{ marginBottom: 16 }}>
          Replay mode — ontology queries reflect current operational state, not the replay timestamp.
        </Callout>
      )}

      {!isCommander ? (
        <Callout
          intent="warning"
          icon="lock"
          title="Commander access required"
          className="briefing-access-denied"
        >
          Ontology query can surface sensitive cross-entity relationships and is restricted
          to Commander-level accounts.
        </Callout>
      ) : (
        <OntologyQueryPanel />
      )}
    </div>
  )
}
