import { Drawer, DrawerSize, Tag, Icon, Classes } from '@blueprintjs/core'
import type { IconName } from '@blueprintjs/icons'
import type { Recommendation, EvidenceItem } from '../api/recommendations'

// ── helpers ────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<EvidenceItem['type'], IconName> = {
  site:     'map-marker',
  incident: 'warning-sign',
  alert:    'lightning',
  task:     'clipboard',
}

const TYPE_INTENT: Record<EvidenceItem['type'], 'primary' | 'warning' | 'danger' | 'none'> = {
  site:     'primary',
  incident: 'danger',
  alert:    'warning',
  task:     'none',
}

const REC_TYPE_LABEL: Record<string, string> = {
  close_stale_alert:  'Close Stale Alert',
  acknowledge_alert:  'Acknowledge Alert',
  escalate_incident:  'Escalate Incident',
  create_task:        'Create Task',
  flag_site:          'Flag Site',
  bulk_triage_alerts: 'Bulk Triage Alerts',
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// ── component ──────────────────────────────────────────────────────────────

interface EvidenceDrawerProps {
  rec:     Recommendation | null
  onClose: () => void
}

export default function EvidenceDrawer({ rec, onClose }: EvidenceDrawerProps) {
  return (
    <Drawer
      isOpen={!!rec}
      onClose={onClose}
      size={DrawerSize.SMALL}
      position="right"
      title={rec ? REC_TYPE_LABEL[rec.recommendation_type] ?? rec.recommendation_type : ''}
      icon="data-lineage"
      className="evidence-drawer"
    >
      {rec && (
        <div className={Classes.DRAWER_BODY} style={{ padding: '16px 20px' }}>

          {/* ── tier + confidence ── */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
            <Tag
              minimal
              intent={rec.tier === 'llm' ? 'primary' : 'none'}
              style={{ fontSize: 11 }}
            >
              {rec.tier === 'llm' ? '🤖 LLM-enriched' : '⚙ Rule-based'}
            </Tag>
            <Tag minimal intent="none" style={{ fontSize: 11 }}>
              {Math.round(rec.confidence * 100)}% confidence
            </Tag>
            <Tag
              minimal
              intent={rec.status === 'executed' ? 'success' : rec.status === 'rejected' ? 'danger' : 'none'}
              style={{ fontSize: 11 }}
            >
              {rec.status}
            </Tag>
          </div>

          {/* ── rationale ── */}
          <section style={{ marginBottom: 20 }}>
            <h4 className="bp6-heading" style={{ fontSize: 13, marginBottom: 8 }}>Rationale</h4>
            <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>{rec.rationale}</p>
          </section>

          {/* ── evidence items ── */}
          {rec.evidence.length > 0 && (
            <section style={{ marginBottom: 20 }}>
              <h4 className="bp6-heading" style={{ fontSize: 13, marginBottom: 8 }}>Evidence</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rec.evidence.map((item, i) => (
                  <div
                    key={i}
                    style={{
                      display:      'flex',
                      alignItems:   'flex-start',
                      gap:          10,
                      padding:      '8px 10px',
                      background:   'var(--bp6-app-background-color, #30404d)',
                      borderRadius: 4,
                      border:       '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <Icon
                      icon={TYPE_ICONS[item.type] ?? 'dot'}
                      intent={TYPE_INTENT[item.type] ?? 'none'}
                      size={14}
                      style={{ marginTop: 2, flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <Tag minimal intent={TYPE_INTENT[item.type] ?? 'none'} style={{ fontSize: 10 }}>
                          {item.type}
                        </Tag>
                        <code className="mono" style={{ fontSize: 10, opacity: 0.7, wordBreak: 'break-all' }}>
                          {item.id}
                        </code>
                      </div>
                      {item.detail && (
                        <div className="bp6-text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                          {item.detail}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── review info ── */}
          {rec.reviewed_by && (
            <section style={{ marginBottom: 16 }}>
              <h4 className="bp6-heading" style={{ fontSize: 13, marginBottom: 8 }}>Review</h4>
              <div className="bp6-text-muted" style={{ fontSize: 12 }}>
                <div>By {rec.reviewed_by.email} at {fmt(rec.reviewed_at!)}</div>
                {rec.review_reason && <div style={{ marginTop: 4 }}>Reason: {rec.review_reason}</div>}
              </div>
            </section>
          )}

          {/* ── timestamps ── */}
          <div className="bp6-text-muted" style={{ fontSize: 11, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
            <div>Created: {fmt(rec.created_at)}</div>
            <div>Expires: {fmt(rec.expires_at)}</div>
            {rec.executed_at && <div>Executed: {fmt(rec.executed_at)}</div>}
          </div>
        </div>
      )}
    </Drawer>
  )
}
