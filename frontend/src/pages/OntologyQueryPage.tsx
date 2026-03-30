import { Callout } from '@blueprintjs/core'
import OntologyQueryPanel from '../components/OntologyQueryPanel'
import { useRole } from '../hooks/useRole'

export default function OntologyQueryPage() {
  const { isCommander } = useRole()

  return (
    <div className="page-content ontology-page">
      <div className="page-header">
        <h2 className="bp6-heading">Ontology Query</h2>
        <span className="bp6-text-muted">Commander-only natural-language traversal across the operational entity graph</span>
      </div>

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
