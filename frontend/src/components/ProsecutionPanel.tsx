/**
 * ProsecutionPanel
 *
 * Kill-chain prosecution workflow panel for an incident.
 * Displayed as the "Prosecution" tab on IncidentDetailPage.
 *
 * Commanders can:
 *   - Initiate prosecution (sets phase to 'assessing')
 *   - Add steps (notes, evidence links, outcome records)
 *   - Advance to the next phase (assessing → executing → concluded)
 *
 * All users can view the prosecution timeline.
 */
import { useState } from 'react'
import {
  Button, Callout, HTMLSelect, NonIdealState, Spinner,
  Tag, TextArea,
} from '@blueprintjs/core'
import {
  useProsecutionSteps,
  useInitiateProsecution,
  useAddProsecutionStep,
} from '../hooks/useIncidents'
import { useRole } from '../hooks/useRole'
import { useReplay } from '../context/ReplayContext'
import type { Incident, ProsecutionPhase, ProsecutionActionType, ProsecutionEvidenceRefs } from '../api/incidents'

// ── constants ─────────────────────────────────────────────────────────────

const PHASES: ProsecutionPhase[] = ['assessing', 'executing', 'concluded']

const PHASE_LABEL: Record<ProsecutionPhase, string> = {
  assessing: 'Assessing',
  executing: 'Executing',
  concluded: 'Concluded',
}

const PHASE_INTENT: Record<ProsecutionPhase, 'warning' | 'primary' | 'danger' | 'success'> = {
  assessing: 'warning',
  executing: 'danger',
  concluded: 'success',
}

const NEXT_PHASE: Partial<Record<ProsecutionPhase, ProsecutionPhase>> = {
  assessing: 'executing',
  executing: 'concluded',
}

const ACTION_TYPE_OPTIONS: { value: ProsecutionActionType; label: string }[] = [
  { value: 'note_added',       label: 'Operational note'   },
  { value: 'evidence_linked',  label: 'Evidence linked'    },
  { value: 'outcome_recorded', label: 'Outcome recorded'   },
]

const ACTION_LABEL: Record<ProsecutionActionType, string> = {
  phase_transition: 'Phase transition',
  note_added:       'Operational note',
  evidence_linked:  'Evidence linked',
  outcome_recorded: 'Outcome recorded',
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function parseSignalIds(raw: string): string[] {
  return raw.trim().split(/[\s,]+/).filter(Boolean)
}

// ── sub-components ────────────────────────────────────────────────────────

function PhaseTrack({ phase }: { phase: ProsecutionPhase | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 20 }}>
      {PHASES.map((p, i) => {
        const isActive  = p === phase
        const isPast    = phase ? PHASES.indexOf(phase) > i : false
        const isFuture  = !isActive && !isPast
        const color     = isActive ? '#f97316' : isPast ? '#22c55e' : '#374151'
        const textColor = isFuture ? '#6b7280' : '#e5e7eb'

        return (
          <div key={p} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{
              display:     'flex',
              flexDirection: 'column',
              alignItems:  'center',
              gap:         4,
            }}>
              <div style={{
                width:        28, height: 28, borderRadius: '50%',
                border:       `2px solid ${color}`,
                background:   isActive ? color : isPast ? '#0a1f0e' : '#111827',
                display:      'flex', alignItems: 'center', justifyContent: 'center',
                fontSize:     11, fontWeight: 700, color: isActive ? '#fff' : color,
                boxShadow:    isActive ? `0 0 8px ${color}88` : undefined,
              }}>
                {isPast ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 10, color: textColor, letterSpacing: 0.5 }}>
                {PHASE_LABEL[p]}
              </span>
            </div>
            {i < PHASES.length - 1 && (
              <div style={{
                width:       40, height: 2, marginBottom: 14,
                background:  isPast ? '#22c55e' : '#374151',
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────

interface Props {
  incident: Incident
  asOf?: string | null
}

export default function ProsecutionPanel({ incident, asOf }: Props) {
  const { isCommander } = useRole()
  const { isReplaying } = useReplay()
  const replayParams = asOf ? { as_of: asOf } : undefined

  const [notes,      setNotes]      = useState('')
  const [actionType, setActionType] = useState<ProsecutionActionType>('note_added')
  const [evidenceRaw, setEvidenceRaw] = useState('')
  const [showForm,   setShowForm]   = useState(false)

  const { data: steps = [], isPending, error } = useProsecutionSteps(incident.id, replayParams, {
    enabled: true,
    refetchInterval: isReplaying ? false : undefined,
  })
  const initiate  = useInitiateProsecution()
  const addStep   = useAddProsecutionStep()

  const phase     = incident.prosecution_phase ?? null
  const nextPhase = phase ? NEXT_PHASE[phase] : null
  const signalIds = parseSignalIds(evidenceRaw)
  const missingEvidence = actionType === 'evidence_linked' && signalIds.length === 0

  function parseEvidenceRefs(): ProsecutionEvidenceRefs {
    return signalIds.length > 0 ? { signal_ids: signalIds } : {}
  }

  function handleInitiate() {
    initiate.mutate({ id: incident.id, notes: notes.trim() || null }, {
      onSuccess: () => setNotes(''),
    })
  }

  function handleAddStep() {
    if (missingEvidence) return

    const trimmed = notes.trim()
    addStep.mutate({
      id: incident.id,
      body: {
        phase:         phase!,
        action_type:   actionType,
        notes:         trimmed || null,
        evidence_refs: parseEvidenceRefs(),
      },
    }, {
      onSuccess: () => {
        setNotes('')
        setEvidenceRaw('')
        setShowForm(false)
      },
    })
  }

  function handleAdvancePhase() {
    if (!nextPhase) return
    addStep.mutate({
      id: incident.id,
      body: {
        phase:         nextPhase,
        action_type:   'phase_transition',
        notes:         notes.trim() || null,
        evidence_refs: {},
      },
    }, {
      onSuccess: () => setNotes(''),
    })
  }

  // Not yet prosecuted — show initiate prompt
  if (!phase) {
    return (
      <div>
        {isReplaying && (
          <Callout intent="primary" compact style={{ marginBottom: 12 }}>
            Showing prosecution state at the replay timestamp. Historical review is read-only.
          </Callout>
        )}
        <NonIdealState
          icon="shield"
          title="Not being prosecuted"
          description={
            isReplaying
              ? 'This incident had not entered prosecution by the replay timestamp.'
              : 'Initiate prosecution to begin a structured kill-chain response for this incident.'
          }
          className="tab-empty-state"
          action={
            isCommander && !isReplaying ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 300 }}>
                <TextArea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Initial assessment note (optional)"
                  rows={2}
                  style={{ fontSize: 13, resize: 'vertical' }}
                />
                <Button
                  intent="warning"
                  icon="shield"
                  loading={initiate.isPending}
                  onClick={handleInitiate}
                >
                  Initiate Prosecution
                </Button>
                {initiate.isError && (
                  <Callout intent="danger" compact style={{ fontSize: 12 }}>
                    {(initiate.error as Error).message}
                  </Callout>
                )}
              </div>
            ) : undefined
          }
        />
      </div>
    )
  }

  // Active prosecution
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isReplaying && (
        <Callout intent="primary" compact>
          Showing prosecution state at the replay timestamp. Historical review is read-only.
        </Callout>
      )}

      {/* ── phase track ── */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8, padding: '14px 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 11, letterSpacing: 1, color: '#9ca3af', fontWeight: 700 }}>
            PROSECUTION PHASE
          </span>
          <Tag minimal intent={PHASE_INTENT[phase]} style={{ fontSize: 11, fontWeight: 700 }}>
            {PHASE_LABEL[phase]}
          </Tag>
        </div>
        <PhaseTrack phase={phase} />

        {incident.prosecuted_by && (
          <div style={{ fontSize: 11, color: '#6b7280' }}>
            Initiated by {incident.prosecuted_by.email}
            {incident.prosecution_initiated_at && ` · ${fmt(incident.prosecution_initiated_at)}`}
          </div>
        )}
      </div>

      {/* ── commander actions ── */}
      {isCommander && phase !== 'concluded' && !isReplaying && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            small
            icon="annotation"
            onClick={() => setShowForm(v => !v)}
          >
            {showForm ? 'Cancel' : 'Add Step'}
          </Button>
          {nextPhase && (
            <Button
              small
              intent={PHASE_INTENT[nextPhase]}
              icon="arrow-right"
              loading={addStep.isPending}
              onClick={handleAdvancePhase}
            >
              Advance → {PHASE_LABEL[nextPhase]}
            </Button>
          )}
        </div>
      )}

      {/* ── add step form ── */}
      {isCommander && showForm && !isReplaying && (
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6, padding: 14,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0 }}>Type:</span>
            <HTMLSelect
              value={actionType}
              onChange={e => setActionType(e.target.value as ProsecutionActionType)}
              minimal
              style={{ fontSize: 12 }}
            >
              {ACTION_TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </HTMLSelect>
          </div>

          <TextArea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Notes… (Ctrl+Enter to submit)"
            rows={3}
            style={{ fontSize: 13, resize: 'vertical' }}
            onKeyDown={e => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                handleAddStep()
              }
            }}
          />

          {actionType === 'evidence_linked' && (
            <>
              <TextArea
                value={evidenceRaw}
                onChange={e => setEvidenceRaw(e.target.value)}
                placeholder="Signal IDs (comma-separated)"
                rows={2}
                style={{ fontSize: 12, resize: 'vertical' }}
              />
              <div style={{ fontSize: 11, color: '#6b7280' }}>
                Evidence-linked steps currently accept signal IDs only.
              </div>
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <Button small minimal onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              small intent="primary"
              loading={addStep.isPending}
              disabled={missingEvidence || (!notes.trim() && actionType !== 'evidence_linked')}
              onClick={handleAddStep}
            >
              Add Step
            </Button>
          </div>

          {addStep.isError && (
            <Callout intent="danger" compact style={{ fontSize: 12 }}>
              {(addStep.error as Error).message}
            </Callout>
          )}
        </div>
      )}

      {/* ── step timeline ── */}
      <div>
        <div style={{ fontSize: 11, letterSpacing: 1, color: '#6b7280', fontWeight: 700, marginBottom: 10 }}>
          PROSECUTION LOG
        </div>

        {isPending && <Spinner size={20} />}
        {error    && <Callout intent="danger" compact>{error.message}</Callout>}

        {!isPending && steps.length === 0 && (
          <div style={{ fontSize: 12, color: '#6b7280' }}>No steps recorded yet.</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {steps.map(step => (
            <div
              key={step.id}
              style={{
                background:   'rgba(255,255,255,0.04)',
                border:       '1px solid rgba(255,255,255,0.08)',
                borderLeft:   `3px solid ${PHASE_INTENT[step.phase] === 'warning' ? '#f97316' : PHASE_INTENT[step.phase] === 'danger' ? '#ef4444' : '#22c55e'}`,
                borderRadius: '0 6px 6px 0',
                padding:      '10px 14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Tag minimal intent={PHASE_INTENT[step.phase]} style={{ fontSize: 10 }}>
                    {PHASE_LABEL[step.phase]}
                  </Tag>
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>
                    {ACTION_LABEL[step.action_type]}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  {step.actor.email} · {fmt(step.occurred_at)}
                </div>
              </div>

              {step.notes && (
                <p style={{ margin: 0, fontSize: 13, color: '#d1d5db', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {step.notes}
                </p>
              )}

              {/* Evidence refs summary */}
              {Object.values(step.evidence_refs).some(v => v && v.length > 0) && (
                <div style={{ marginTop: 6, fontSize: 11, color: '#6b7280' }}>
                  {Object.entries(step.evidence_refs)
                    .filter(([, v]) => v && v.length > 0)
                    .map(([k, v]) => `${k}: ${v!.join(', ')}`)
                    .join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
