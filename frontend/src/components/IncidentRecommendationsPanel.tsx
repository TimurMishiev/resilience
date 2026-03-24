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
}

export default function IncidentRecommendationsPanel({ incidentId }: Props) {
  const [evidenceRec, setEvidenceRec] = useState<Recommendation | null>(null)
  const { isCommander } = useRole()
  const { isReplaying } = useReplay()

  const { data, isPending, error } = useRecommendations({
    affected_entity_type: 'Incident',
    affected_entity_id:   incidentId,
  } as Parameters<typeof useRecommendations>[0], {
    enabled: !isReplaying,
    refetchInterval: isReplaying ? false : 60_000,
  })

  const recs = data?.data ?? []

  return (
    <div>
      {isReplaying && (
        <Callout intent="warning" compact>
          Incident recommendations are unavailable during replay because recommendation state is live-only.
        </Callout>
      )}
      {!isReplaying && isPending && <Spinner size={20} style={{ marginTop: 16 }} />}
      {!isReplaying && error    && <Callout intent="danger" compact>{error.message}</Callout>}

      {!isReplaying && !isPending && recs.length === 0 && (
        <NonIdealState
          icon="lightbulb"
          title="No recommendations"
          description="No active recommendations target this incident."
          className="tab-empty-state"
        />
      )}

      {!isReplaying && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {recs.map(rec => (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              onViewEvidence={() => setEvidenceRec(rec)}
              isCommander={isCommander}
            />
          ))}
        </div>
      )}

      <EvidenceDrawer rec={evidenceRec} onClose={() => setEvidenceRec(null)} />
    </div>
  )
}
