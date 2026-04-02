/**
 * IncidentRecommendationsPanel
 *
 * Shows active recommendations whose affected entity is this incident,
 * with inline accept / reject / execute actions for commanders.
 * Uses the existing RecommendationCard component so UI is consistent
 * with the dedicated recommendations page.
 */
import { useState } from 'react'
import { NonIdealState, Spinner, Callout } from '@blueprintjs/core'
import { useRecommendations } from '../hooks/useRecommendations'
import { useRole } from '../hooks/useRole'
import { useReplay } from '../context/ReplayContext'
import RecommendationCard from './RecommendationCard'
import EvidenceDrawer from './EvidenceDrawer'
import type { Recommendation } from '../api/recommendations'

interface Props {
  incidentId: string
  asOf?: string | null
  isReadOnly?: boolean
}

export default function IncidentRecommendationsPanel({ incidentId, asOf, isReadOnly = false }: Props) {
  const [evidenceRec, setEvidenceRec] = useState<Recommendation | null>(null)
  const { isCommander } = useRole()
  const { isReplaying } = useReplay()

  const { data, isPending, error } = useRecommendations({
    affected_entity_type: 'Incident',
    affected_entity_id:   incidentId,
    ...(asOf ? { as_of: asOf } : {}),
  } as Parameters<typeof useRecommendations>[0], {
    enabled: true,
    refetchInterval: isReplaying ? false : 60_000,
  })

  const recs = data?.data ?? []

  return (
    <div>
      {isReplaying && (
        <Callout intent="primary" compact>
          Showing incident recommendations as they existed at the replay timestamp. Review actions are disabled.
        </Callout>
      )}
      {isPending && <Spinner size={20} style={{ marginTop: 16 }} />}
      {error    && <Callout intent="danger" compact>{error.message}</Callout>}

      {!isPending && recs.length === 0 && (
        <NonIdealState
          icon="lightbulb"
          title="No recommendations"
          description={isReplaying ? 'No recommendations targeted this incident at the replay timestamp.' : 'No active recommendations target this incident.'}
          className="tab-empty-state"
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {recs.map(rec => (
          <RecommendationCard
            key={rec.id}
            rec={rec}
            onViewEvidence={() => setEvidenceRec(rec)}
            isCommander={isCommander}
            isReadOnly={isReadOnly}
          />
        ))}
      </div>

      <EvidenceDrawer rec={evidenceRec} onClose={() => setEvidenceRec(null)} />
    </div>
  )
}
