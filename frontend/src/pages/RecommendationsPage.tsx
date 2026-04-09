import { useState } from 'react'
import {
  Button, Callout, HTMLSelect, NonIdealState, Spinner,
  Tag, Tabs, Tab,
} from '@blueprintjs/core'
import {
  useRecommendations,
  useRecommendationMetrics,
  useGenerateRecommendations,
} from '../hooks/useRecommendations'
import { useRole } from '../hooks/useRole'
import { useReplay } from '../context/ReplayContext'
import RecommendationCard from '../components/RecommendationCard'
import EvidenceDrawer from '../components/EvidenceDrawer'
import type { Recommendation } from '../api/recommendations'

// ── constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: '',         label: 'Active (pending)'   },
  { value: 'accepted', label: 'Accepted'            },
  { value: 'rejected', label: 'Rejected'            },
  { value: 'deferred', label: 'Deferred'            },
  { value: 'executed', label: 'Executed'            },
  { value: 'expired',  label: 'Expired'             },
]

// ── page ─────────────────────────────────────────────────────────────────────

export default function RecommendationsPage() {
  const role = useRole()
  const canReviewRecommendations = role.canReviewRecommendations ?? role.isCommander
  const canGenerateRecommendations = role.canGenerateRecommendations ?? role.isCommander
  const { isReplaying, asOf } = useReplay()
  const [statusFilter, setStatusFilter] = useState('')
  const [evidenceRec, setEvidenceRec]   = useState<Recommendation | null>(null)
  const statusOptions = isReplaying
    ? [{ ...STATUS_OPTIONS[0], label: 'All statuses' }, ...STATUS_OPTIONS.slice(1)]
    : STATUS_OPTIONS

  const replayParams = isReplaying && asOf ? { as_of: asOf } : {}
  const { data, isPending, error } = useRecommendations(
    { ...(statusFilter ? { status: statusFilter } : {}), ...replayParams },
    { refetchInterval: isReplaying ? false : 60_000 },
  )
  const { data: metrics } = useRecommendationMetrics({ enabled: !isReplaying, refetchInterval: isReplaying ? false : 120_000 })
  const generate = useGenerateRecommendations()

  const recs = data?.data ?? []

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="bp6-heading" style={{ margin: 0 }}>Recommendations</h1>
        <span className="bp6-text-muted" style={{ fontSize: 13, marginLeft: 8 }}>
          {data?.meta.total ?? '—'} {isReplaying ? 'visible' : 'active'}
        </span>
        {canGenerateRecommendations && !isReplaying && (
          <Button
            small
            icon="predictive-analysis"
            intent="primary"
            loading={generate.isPending}
            onClick={() => generate.mutate(undefined)}
            style={{ marginLeft: 'auto' }}
            title="Trigger an on-demand recommendation generation pass"
          >
            Generate Now
          </Button>
        )}
      </div>

      {isReplaying && (
        <Callout intent="primary" icon="info-sign" style={{ marginBottom: 12 }}>
          Showing recommendations as they existed at the replay timestamp. Review actions are disabled.
        </Callout>
      )}

      {/* ── metrics bar ── */}
      {!isReplaying && metrics && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', fontSize: 12 }}>
          <MetricPill label="Pending"  value={metrics.pending}  intent="primary" />
          <MetricPill label="Accepted" value={metrics.accepted} intent="success" />
          <MetricPill label="Executed" value={metrics.executed} intent="success" />
          <MetricPill label="Deferred" value={metrics.deferred} intent="none"    />
          <MetricPill label="Rejected" value={metrics.rejected} intent="danger"  />
          <MetricPill label="Expired"  value={metrics.expired}  intent="none"    />
          {metrics.accept_rate != null && (
            <span className="bp6-text-muted">
              Accept rate: {metrics.accept_rate}%
            </span>
          )}
          <span className="bp6-text-muted" style={{ marginLeft: 'auto' }}>
            Rule: {metrics.by_tier.rule} · LLM: {metrics.by_tier.llm}
          </span>
        </div>
      )}

      {/* ── filter bar ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <HTMLSelect
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          minimal
          style={{ fontSize: 13 }}
        >
          {statusOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </HTMLSelect>
        {statusFilter && (
          <Button minimal small onClick={() => setStatusFilter('')}>Clear</Button>
        )}
      </div>

      {isPending && <Spinner size={24} style={{ marginTop: 24 }} />}
      {error && <Callout intent="danger" compact>{error.message}</Callout>}

      {!isPending && !error && recs.length === 0 && (
        <NonIdealState
          icon="lightbulb"
          title="No recommendations"
          description={
            isReplaying
              ? 'No recommendations existed at the selected replay timestamp.'
              : statusFilter
                ? `No ${statusFilter} recommendations.`
                : canGenerateRecommendations
                  ? 'No active recommendations. Click "Generate Now" to run a fresh analysis.'
                  : 'No active recommendations at this time. The system analyses your operational state every 30 minutes.'
          }
        />
      )}

      {!isPending && recs.length > 0 && (
        <Tabs id="rec-tier-tabs" defaultSelectedTabId="rule">
          <Tab
            id="rule"
            title={`Rule-based (${recs.filter(r => r.tier === 'rule').length})`}
            panel={
              <div style={{ paddingTop: 12 }}>
                {recs.filter(r => r.tier === 'rule').map(rec => (
                  <RecommendationCard
                    key={rec.id}
                    rec={rec}
                    onViewEvidence={setEvidenceRec}
                    isCommander={canReviewRecommendations}
                    isReadOnly={isReplaying}
                  />
                ))}
                {recs.filter(r => r.tier === 'rule').length === 0 && (
                  <NonIdealState icon="tick" title="No rule-based recommendations" className="tab-empty-state" />
                )}
              </div>
            }
          />
          <Tab
            id="llm"
            title={`AI-enriched (${recs.filter(r => r.tier === 'llm').length})`}
            panel={
              <div style={{ paddingTop: 12 }}>
                {recs.filter(r => r.tier === 'llm').length === 0 && (
                  <NonIdealState
                    icon="predictive-analysis"
                    title="No AI-enriched recommendations"
                    description="LLM-tier recommendations appear when Anthropic API key is configured."
                    className="tab-empty-state"
                  />
                )}
                {recs.filter(r => r.tier === 'llm').map(rec => (
                  <RecommendationCard
                    key={rec.id}
                    rec={rec}
                    onViewEvidence={setEvidenceRec}
                    isCommander={canReviewRecommendations}
                    isReadOnly={isReplaying}
                  />
                ))}
              </div>
            }
          />
        </Tabs>
      )}

      <EvidenceDrawer rec={evidenceRec} onClose={() => setEvidenceRec(null)} />
    </div>
  )
}

// ── sub-component ─────────────────────────────────────────────────────────────

function MetricPill({
  label, value, intent,
}: { label: string; value: number; intent: 'primary' | 'success' | 'danger' | 'none' }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span className="bp6-text-muted">{label}:</span>
      <Tag minimal intent={value > 0 ? intent : 'none'} style={{ fontSize: 11 }}>
        {value}
      </Tag>
    </span>
  )
}
