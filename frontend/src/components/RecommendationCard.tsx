import { Button, Card, Icon, ProgressBar, Tag } from '@blueprintjs/core'
import type { IconName } from '@blueprintjs/icons'
import type { Recommendation } from '../api/recommendations'
import {
  useAcceptRecommendation,
  useRejectRecommendation,
  useDeferRecommendation,
  useExecuteRecommendation,
} from '../hooks/useRecommendations'
import { REC_TYPE_LABEL } from '../utils/recommendationLabels'

// ── constants ──────────────────────────────────────────────────────────────

const REC_TYPE_ICON: Record<string, IconName> = {
  close_stale_alert:  'cross',
  acknowledge_alert:  'eye-open',
  escalate_incident:  'arrow-up',
  create_task:        'add',
  flag_site:          'flag',
  bulk_triage_alerts: 'multi-select',
}

// ── component ──────────────────────────────────────────────────────────────

interface RecommendationCardProps {
  rec:           Recommendation
  onViewEvidence: (rec: Recommendation) => void
  isCommander:   boolean
}

export default function RecommendationCard({ rec, onViewEvidence, isCommander }: RecommendationCardProps) {
  const accept  = useAcceptRecommendation()
  const reject  = useRejectRecommendation()
  const defer   = useDeferRecommendation()
  const execute = useExecuteRecommendation()

  const isPending   = rec.status === 'pending'
  const isLoading   = accept.isPending || reject.isPending || defer.isPending || execute.isPending
  const confPct     = Math.round(rec.confidence * 100)

  return (
    <Card
      compact
      style={{
        marginBottom: 8,
        borderLeft: `3px solid ${rec.tier === 'llm' ? 'var(--bp6-intent-primary-color, #4B74D9)' : 'rgba(255,255,255,0.2)'}`,
        opacity: isPending ? 1 : 0.65,
      }}
    >
      {/* ── header row ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon icon={REC_TYPE_ICON[rec.recommendation_type] ?? 'lightbulb'} size={14} />
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
          {REC_TYPE_LABEL[rec.recommendation_type] ?? rec.recommendation_type}
        </span>

        <Tag minimal intent={rec.tier === 'llm' ? 'primary' : 'none'} style={{ fontSize: 10 }}>
          {rec.tier}
        </Tag>

        {!isPending && (
          <Tag
            minimal
            intent={rec.status === 'executed' ? 'success' : rec.status === 'rejected' ? 'danger' : 'none'}
            style={{ fontSize: 10 }}
          >
            {rec.status}
          </Tag>
        )}
      </div>

      {/* ── confidence bar ── */}
      <div style={{ marginBottom: 8 }}>
        <ProgressBar
          value={rec.confidence}
          intent={confPct >= 80 ? 'danger' : confPct >= 60 ? 'warning' : 'primary'}
          animate={false}
          stripes={false}
          style={{ height: 4 }}
        />
        <span className="bp6-text-muted" style={{ fontSize: 10 }}>{confPct}% confidence</span>
      </div>

      {/* ── rationale ── */}
      <p style={{ fontSize: 12, lineHeight: 1.4, margin: '0 0 10px', color: 'var(--bp6-text-color, inherit)' }}>
        {rec.rationale.length > 140
          ? `${rec.rationale.slice(0, 140)}…`
          : rec.rationale}
      </p>

      {/* ── evidence count + action buttons ── */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {rec.evidence.length > 0 && (
          <Button
            minimal
            small
            icon="data-lineage"
            onClick={() => onViewEvidence(rec)}
            style={{ fontSize: 11 }}
          >
            {rec.evidence.length} evidence item{rec.evidence.length !== 1 ? 's' : ''}
          </Button>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {isPending && isCommander && (
            <>
              <Button
                small
                intent="success"
                loading={execute.isPending}
                disabled={isLoading}
                onClick={() => execute.mutate(rec.id)}
                title="Accept & execute immediately"
              >
                Execute
              </Button>
              <Button
                small
                intent="primary"
                loading={accept.isPending}
                disabled={isLoading}
                onClick={() => accept.mutate({ id: rec.id })}
                title="Accept (mark reviewed, execute later)"
              >
                Accept
              </Button>
              <Button
                small
                minimal
                loading={defer.isPending}
                disabled={isLoading}
                onClick={() => defer.mutate({ id: rec.id })}
                title="Defer"
              >
                Defer
              </Button>
              <Button
                small
                minimal
                intent="danger"
                loading={reject.isPending}
                disabled={isLoading}
                onClick={() => reject.mutate({ id: rec.id })}
                title="Reject"
              >
                ✕
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}
