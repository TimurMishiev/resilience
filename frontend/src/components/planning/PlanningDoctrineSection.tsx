import type { Dispatch, SetStateAction } from 'react'
import {
  Button,
  Callout,
  Card,
  FormGroup,
  HTMLSelect,
  HTMLTable,
  InputGroup,
  TextArea,
} from '@blueprintjs/core'
import type { AreaOfOperation, CommanderIntent, PacePlan, SaluteReport, Site } from '../../api/types'
import { humanize } from '../../utils/humanize'
import type { IntentDraft, PaceDraft, SaluteDraft } from '../../lib/planningPageUtils'

interface Props {
  areasOfOperation: AreaOfOperation[]
  selectedDoctrineAoId: string
  selectedDoctrineAo: AreaOfOperation | null
  selectedCommanderIntent: CommanderIntent | null
  selectedPacePlan: PacePlan | null
  doctrineSites: Site[]
  doctrineSaluteReports: SaluteReport[]
  doctrineSaluteMeta: { truncated: boolean; count: number }
  intentDraft: IntentDraft
  paceDraft: PaceDraft
  saluteDraft: SaluteDraft
  setIntentDraft: Dispatch<SetStateAction<IntentDraft>>
  setPaceDraft: Dispatch<SetStateAction<PaceDraft>>
  setSaluteDraft: Dispatch<SetStateAction<SaluteDraft>>
  onDoctrineAoChange: (areaOfOperationId: string) => void
  onIntentSave: () => void
  onPaceSave: () => void
  onSaluteSubmit: () => void
  isReplaying: boolean
  intentError: string | null
  paceError: string | null
  saluteError: string | null
  intentNotice: string | null
  paceNotice: string | null
  saluteNotice: string | null
  intentSaving: boolean
  paceSaving: boolean
  saluteSaving: boolean
}

export function PlanningDoctrineSection({
  areasOfOperation,
  selectedDoctrineAoId,
  selectedDoctrineAo,
  selectedCommanderIntent,
  selectedPacePlan,
  doctrineSites,
  doctrineSaluteReports,
  doctrineSaluteMeta,
  intentDraft,
  paceDraft,
  saluteDraft,
  setIntentDraft,
  setPaceDraft,
  setSaluteDraft,
  onDoctrineAoChange,
  onIntentSave,
  onPaceSave,
  onSaluteSubmit,
  isReplaying,
  intentError,
  paceError,
  saluteError,
  intentNotice,
  paceNotice,
  saluteNotice,
  intentSaving,
  paceSaving,
  saluteSaving,
}: Props) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h3 className="bp6-heading" style={{ fontSize: 14, marginBottom: 10, color: 'var(--bp6-text-muted-color)' }}>
        COMMANDER DOCTRINE
      </h3>
      {areasOfOperation.length === 0 ? (
        <Callout intent="warning" compact>
          Create an area of operation before recording commander intent, PACE, or SALUTE doctrine.
        </Callout>
      ) : (
        <>
          <div style={{ marginBottom: 16, maxWidth: 320 }}>
            <FormGroup label="Area of operation" inline>
              <HTMLSelect
                fill
                value={selectedDoctrineAoId}
                onChange={event => onDoctrineAoChange(event.target.value)}
                options={areasOfOperation.map(ao => ({ label: ao.name, value: ao.id }))}
              />
            </FormGroup>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 16 }}>
            <Card style={{ background: 'rgba(255,255,255,0.02)' }}>
              <h4 className="bp6-heading" style={{ marginTop: 0, marginBottom: 12 }}>Commander Intent</h4>
              {selectedDoctrineAo && (
                <div className="bp6-text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
                  {selectedDoctrineAo.name} · {humanize(selectedDoctrineAo.posture)}
                </div>
              )}
              <FormGroup label="Intent title" labelFor="commander-intent-title">
                <InputGroup
                  id="commander-intent-title"
                  value={intentDraft.title}
                  onChange={event => setIntentDraft(prev => ({ ...prev, title: event.target.value }))}
                  placeholder="Secure northern shipping corridor"
                />
              </FormGroup>
              <FormGroup label="Objective" labelFor="commander-intent-objective">
                <TextArea
                  id="commander-intent-objective"
                  fill
                  rows={4}
                  value={intentDraft.objective}
                  onChange={event => setIntentDraft(prev => ({ ...prev, objective: event.target.value }))}
                  placeholder="What must the force accomplish in this AO?"
                />
              </FormGroup>
              <FormGroup label="End state" labelFor="commander-intent-end-state">
                <TextArea
                  id="commander-intent-end-state"
                  fill
                  rows={4}
                  value={intentDraft.end_state}
                  onChange={event => setIntentDraft(prev => ({ ...prev, end_state: event.target.value }))}
                  placeholder="Describe the desired operational picture when this intent is satisfied."
                />
              </FormGroup>
              <FormGroup label="Constraints" labelFor="commander-intent-constraints">
                <TextArea
                  id="commander-intent-constraints"
                  fill
                  rows={3}
                  value={intentDraft.constraints}
                  onChange={event => setIntentDraft(prev => ({ ...prev, constraints: event.target.value }))}
                  placeholder="Operational or political constraints, ROE limitations, civilian concerns."
                />
              </FormGroup>
              {intentError && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{intentError}</Callout>}
              {intentNotice && <Callout intent="success" compact style={{ marginBottom: 12 }}>{intentNotice}</Callout>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <span className="bp6-text-muted" style={{ fontSize: 12 }}>
                  {selectedCommanderIntent ? `Last updated ${new Date(selectedCommanderIntent.updated_at).toLocaleString()}` : 'No intent recorded yet'}
                </span>
                <Button intent="primary" disabled={isReplaying} loading={intentSaving} onClick={onIntentSave}>
                  Save commander intent
                </Button>
              </div>
            </Card>

            <Card style={{ background: 'rgba(255,255,255,0.02)' }}>
              <h4 className="bp6-heading" style={{ marginTop: 0, marginBottom: 12 }}>PACE Plan</h4>
              <FormGroup label="Primary" labelFor="pace-primary">
                <InputGroup
                  id="pace-primary"
                  value={paceDraft.primary_plan}
                  onChange={event => setPaceDraft(prev => ({ ...prev, primary_plan: event.target.value }))}
                  placeholder="SATCOM mission chat"
                />
              </FormGroup>
              <FormGroup label="Alternate" labelFor="pace-alternate">
                <InputGroup
                  id="pace-alternate"
                  value={paceDraft.alternate_plan}
                  onChange={event => setPaceDraft(prev => ({ ...prev, alternate_plan: event.target.value }))}
                  placeholder="Secure VHF relay"
                />
              </FormGroup>
              <FormGroup label="Contingency" labelFor="pace-contingency">
                <InputGroup
                  id="pace-contingency"
                  value={paceDraft.contingency_plan}
                  onChange={event => setPaceDraft(prev => ({ ...prev, contingency_plan: event.target.value }))}
                  placeholder="Burst SMS via field gateway"
                />
              </FormGroup>
              <FormGroup label="Emergency" labelFor="pace-emergency">
                <InputGroup
                  id="pace-emergency"
                  value={paceDraft.emergency_plan}
                  onChange={event => setPaceDraft(prev => ({ ...prev, emergency_plan: event.target.value }))}
                  placeholder="HF voice net or courier fallback"
                />
              </FormGroup>
              <FormGroup label="Notes" labelFor="pace-notes">
                <TextArea
                  id="pace-notes"
                  fill
                  rows={3}
                  value={paceDraft.notes}
                  onChange={event => setPaceDraft(prev => ({ ...prev, notes: event.target.value }))}
                  placeholder="Escalation thresholds, relay assumptions, or network caveats."
                />
              </FormGroup>
              {paceError && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{paceError}</Callout>}
              {paceNotice && <Callout intent="success" compact style={{ marginBottom: 12 }}>{paceNotice}</Callout>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <span className="bp6-text-muted" style={{ fontSize: 12 }}>
                  {selectedPacePlan ? `Last updated ${new Date(selectedPacePlan.updated_at).toLocaleString()}` : 'No PACE plan recorded yet'}
                </span>
                <Button intent="primary" disabled={isReplaying} loading={paceSaving} onClick={onPaceSave}>
                  Save PACE plan
                </Button>
              </div>
            </Card>
          </div>

          <Card style={{ marginBottom: 16, background: 'rgba(255,255,255,0.02)' }}>
            <h4 className="bp6-heading" style={{ marginTop: 0, marginBottom: 12 }}>SALUTE Report</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <FormGroup label="Site" labelFor="salute-site">
                <HTMLSelect
                  id="salute-site"
                  fill
                  value={saluteDraft.site_id}
                  onChange={event => setSaluteDraft(prev => ({ ...prev, site_id: event.target.value }))}
                  options={[
                    { label: 'Area-wide / not site-specific', value: '' },
                    ...doctrineSites.map(site => ({ label: site.name, value: site.id })),
                  ]}
                />
              </FormGroup>
              <FormGroup label="Size" labelFor="salute-size">
                <InputGroup
                  id="salute-size"
                  value={saluteDraft.size}
                  onChange={event => setSaluteDraft(prev => ({ ...prev, size: event.target.value }))}
                  placeholder="2 fast boats"
                />
              </FormGroup>
              <FormGroup label="Unit" labelFor="salute-unit">
                <InputGroup
                  id="salute-unit"
                  value={saluteDraft.unit}
                  onChange={event => setSaluteDraft(prev => ({ ...prev, unit: event.target.value }))}
                  placeholder="Unknown irregular maritime element"
                />
              </FormGroup>
              <FormGroup label="Time observed" labelFor="salute-observed-at">
                <InputGroup
                  id="salute-observed-at"
                  type="datetime-local"
                  value={saluteDraft.observed_at}
                  onChange={event => setSaluteDraft(prev => ({ ...prev, observed_at: event.target.value }))}
                />
              </FormGroup>
            </div>
            <FormGroup label="Activity" labelFor="salute-activity">
              <TextArea
                id="salute-activity"
                fill
                rows={3}
                value={saluteDraft.activity}
                onChange={event => setSaluteDraft(prev => ({ ...prev, activity: event.target.value }))}
                placeholder="Describe what the observed element is doing."
              />
            </FormGroup>
            <FormGroup label="Location" labelFor="salute-location">
              <TextArea
                id="salute-location"
                fill
                rows={2}
                value={saluteDraft.location}
                onChange={event => setSaluteDraft(prev => ({ ...prev, location: event.target.value }))}
                placeholder="Grid, landmark, lane, harbor, or route description."
              />
            </FormGroup>
            <FormGroup label="Equipment" labelFor="salute-equipment">
              <TextArea
                id="salute-equipment"
                fill
                rows={2}
                value={saluteDraft.equipment}
                onChange={event => setSaluteDraft(prev => ({ ...prev, equipment: event.target.value }))}
                placeholder="Observed kit, comms, armament, or sensor packages."
              />
            </FormGroup>
            <FormGroup label="Remarks" labelFor="salute-remarks">
              <TextArea
                id="salute-remarks"
                fill
                rows={2}
                value={saluteDraft.remarks}
                onChange={event => setSaluteDraft(prev => ({ ...prev, remarks: event.target.value }))}
                placeholder="Assessment, caveats, or follow-on collection needs."
              />
            </FormGroup>
            {saluteError && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{saluteError}</Callout>}
            {saluteNotice && <Callout intent="success" compact style={{ marginBottom: 12 }}>{saluteNotice}</Callout>}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span className="bp6-text-muted" style={{ fontSize: 12 }}>
                {selectedDoctrineAo ? `${selectedDoctrineAo.name} · ${doctrineSaluteReports.length} recent report${doctrineSaluteReports.length === 1 ? '' : 's'}` : 'Select an area of operation'}
              </span>
              <Button intent="primary" disabled={isReplaying} loading={saluteSaving} onClick={onSaluteSubmit}>
                Submit SALUTE report
              </Button>
            </div>
          </Card>

          {doctrineSaluteMeta.truncated && (
            <Callout intent="warning" icon="history" compact style={{ marginBottom: 12 }}>
              Showing the most recent {doctrineSaluteMeta.count} SALUTE reports for this area of operation.
            </Callout>
          )}

          <HTMLTable compact bordered style={{ width: '100%', maxWidth: 1200 }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Site</th>
                <th>Size</th>
                <th>Activity</th>
                <th>Unit</th>
                <th>Location</th>
                <th>Equipment</th>
              </tr>
            </thead>
            <tbody>
              {doctrineSaluteReports.length === 0 ? (
                <tr>
                  <td colSpan={7} className="bp6-text-muted" style={{ fontSize: 12 }}>
                    No SALUTE reports recorded for this area of operation yet.
                  </td>
                </tr>
              ) : (
                doctrineSaluteReports.map(report => (
                  <tr key={report.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{new Date(report.observed_at).toLocaleString()}</td>
                    <td style={{ fontSize: 12 }}>{report.site_name ?? 'AO-wide'}</td>
                    <td style={{ fontSize: 12 }}>{report.size || '—'}</td>
                    <td style={{ fontSize: 12 }}>{report.activity}</td>
                    <td style={{ fontSize: 12 }}>{report.unit || '—'}</td>
                    <td style={{ fontSize: 12 }}>{report.location}</td>
                    <td style={{ fontSize: 12 }}>{report.equipment || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </HTMLTable>
        </>
      )}
    </section>
  )
}
