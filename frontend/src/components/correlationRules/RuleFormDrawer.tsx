import { useState, useEffect } from 'react'
import {
  Button,
  ButtonGroup,
  Callout,
  Divider,
  Drawer,
  DrawerSize,
  FormGroup,
  HTMLSelect,
  InputGroup,
  NumericInput,
  Switch,
  Tag,
  TextArea,
} from '@blueprintjs/core'
import type { CorrelationRule } from '../../api/types'
import type { AreaOfOperation } from '../../api/types'
import type { RuleEffectivenessStats } from '../../api/correlation_rules'
import { useCreateCorrelationRule, useUpdateCorrelationRule } from '../../hooks/useCorrelationRules'
import { RuleSparkline } from '../RuleSparkline'
import { CompoundBuilder } from './CompoundBuilder'
import {
  DEFAULT_FORM,
  SIGNAL_TYPE_OPTIONS,
  PRIORITY_OPTIONS,
  MITRE_TECHNIQUES,
  MITRE_BY_ID,
  ruleToForm,
  buildRulePayload,
  newCondition,
} from './types'
import type { RuleFormState, ConditionRow } from './types'
import type { SignalType, TaskPriority } from '../../api/types'

interface RuleFormDrawerProps {
  isOpen:           boolean
  onClose:          () => void
  editingRule:      CorrelationRule | null
  initialForm?:     RuleFormState
  aoList:           AreaOfOperation[]
  effectivenessData?: Record<string, RuleEffectivenessStats>
}

export function RuleFormDrawer({
  isOpen, onClose, editingRule, initialForm, aoList, effectivenessData,
}: RuleFormDrawerProps) {
  const [form, setForm] = useState<RuleFormState>(DEFAULT_FORM)

  // Reset form whenever the drawer opens or the target rule / seed changes.
  useEffect(() => {
    if (!isOpen) return
    if (editingRule) {
      setForm(ruleToForm(editingRule))
    } else {
      setForm(initialForm ?? DEFAULT_FORM)
    }
  }, [isOpen, editingRule, initialForm])

  const createMutation = useCreateCorrelationRule()
  const updateMutation = useUpdateCorrelationRule()
  const isSaving = createMutation.isPending || updateMutation.isPending

  function handleSave() {
    const payload = buildRulePayload(form)
    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, body: payload }, { onSuccess: onClose })
    } else {
      createMutation.mutate(payload, { onSuccess: onClose })
    }
  }

  function updateCompoundCondition(index: number, field: keyof ConditionRow, value: unknown) {
    setForm(f => ({
      ...f,
      compound_conditions: f.compound_conditions.map((c, i) =>
        i === index ? { ...c, [field]: value } : c
      ),
    }))
  }

  function addCompoundCondition() {
    setForm(f => ({ ...f, compound_conditions: [...f.compound_conditions, newCondition()] }))
  }

  function removeCompoundCondition(index: number) {
    setForm(f => ({ ...f, compound_conditions: f.compound_conditions.filter((_, i) => i !== index) }))
  }

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={editingRule ? `Edit: ${editingRule.name}` : 'New Correlation Rule'}
      size={DrawerSize.SMALL}
      className="bp6-dark"
    >
      <div style={{ padding: 20, overflowY: 'auto' }}>
        <FormGroup label="Rule Name" labelInfo="(required)">
          <InputGroup
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Air Activity Near Site"
          />
        </FormGroup>

        <FormGroup label="Description">
          <TextArea
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            fill rows={2} placeholder="Optional description..."
          />
        </FormGroup>

        <Switch
          checked={form.is_active}
          onChange={e => setForm(f => ({ ...f, is_active: (e.target as HTMLInputElement).checked }))}
          label="Active"
        />

        {/* ── SCOPE ─────────────────────────────────────────── */}
        <Divider style={{ margin: '16px 0 12px' }} />
        <p className="bp6-text-muted" style={{ fontSize: 12, marginBottom: 12 }}>SCOPE</p>
        <FormGroup
          label="Area of Operation"
          helperText="Limit this rule to sites within one AO. Leave blank to evaluate against all active sites."
        >
          <HTMLSelect
            value={form.area_of_operation_id ?? ''}
            onChange={e => setForm(f => ({ ...f, area_of_operation_id: e.target.value || null }))}
            fill
          >
            <option value="">All sites (global)</option>
            {aoList.map(ao => (
              <option key={ao.id} value={ao.id}>{ao.name}</option>
            ))}
          </HTMLSelect>
        </FormGroup>

        {/* ── CONDITIONS ──────────────────────────────────────── */}
        <Divider style={{ margin: '16px 0 12px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <p className="bp6-text-muted" style={{ fontSize: 12, margin: 0 }}>CONDITIONS</p>
          <ButtonGroup>
            <Button
              small
              active={form.condition_mode === 'simple'}
              onClick={() => setForm(f => ({ ...f, condition_mode: 'simple' }))}
            >
              Simple
            </Button>
            <Button
              small
              active={form.condition_mode === 'compound'}
              intent={form.condition_mode === 'compound' ? 'warning' : 'none'}
              onClick={() => setForm(f => ({ ...f, condition_mode: 'compound' }))}
            >
              Compound
            </Button>
          </ButtonGroup>
        </div>

        {form.condition_mode === 'simple' ? (
          <>
            <FormGroup label="Signal Type">
              <HTMLSelect
                value={form.signal_type}
                onChange={e => setForm(f => ({ ...f, signal_type: e.target.value as SignalType }))}
                fill
              >
                <option value="">Any signal type</option>
                {SIGNAL_TYPE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </HTMLSelect>
            </FormGroup>

            <FormGroup label="Proximity (km)" helperText="Fire when signal is within this distance of a site">
              <NumericInput
                value={form.proximity_km}
                onValueChange={val => setForm(f => ({ ...f, proximity_km: val }))}
                min={1} max={5000} fill
              />
            </FormGroup>

            <FormGroup label="Min Magnitude" helperText="Leave blank for non-seismic rules">
              <NumericInput
                value={form.magnitude_min === '' ? '' : form.magnitude_min}
                onValueChange={(val, str) => setForm(f => ({ ...f, magnitude_min: str === '' ? '' : val }))}
                min={0} max={10} fill placeholder="e.g. 4.5"
              />
            </FormGroup>

            <FormGroup label="Count Threshold" helperText="Number of signals needed to trigger (1 = any single signal)">
              <NumericInput
                value={form.count_threshold}
                onValueChange={val => setForm(f => ({ ...f, count_threshold: val }))}
                min={1} max={100} fill
              />
            </FormGroup>

            <FormGroup label="Time Window (minutes)" helperText="Window for count threshold evaluation">
              <NumericInput
                value={form.time_window_minutes}
                onValueChange={val => setForm(f => ({ ...f, time_window_minutes: val }))}
                min={1} max={1440} fill
              />
            </FormGroup>
          </>
        ) : (
          <CompoundBuilder
            operator={form.compound_operator}
            conditions={form.compound_conditions}
            onOperatorChange={op => setForm(f => ({ ...f, compound_operator: op }))}
            onConditionChange={updateCompoundCondition}
            onAddCondition={addCompoundCondition}
            onRemoveCondition={removeCompoundCondition}
          />
        )}

        {/* ── ACTION ──────────────────────────────────────────── */}
        <Divider style={{ margin: '16px 0 12px' }} />
        <p className="bp6-text-muted" style={{ fontSize: 12, marginBottom: 12 }}>ACTION — CREATE TASK</p>

        <FormGroup label="Task Title" helperText="Use {{site_name}}, {{proximity_km}}, {{count}}">
          <InputGroup
            value={form.task_title}
            onChange={e => setForm(f => ({ ...f, task_title: e.target.value }))}
            placeholder="e.g. Air activity near {{site_name}}"
          />
        </FormGroup>

        <FormGroup label="Task Description">
          <TextArea
            value={form.task_description}
            onChange={e => setForm(f => ({ ...f, task_description: e.target.value }))}
            fill rows={3}
            placeholder="Use {{site_name}}, {{proximity_km}}, {{count}}, {{signal_type}}, {{source}}"
          />
        </FormGroup>

        <FormGroup label="Task Priority">
          <HTMLSelect
            value={form.task_priority}
            onChange={e => setForm(f => ({ ...f, task_priority: e.target.value as TaskPriority }))}
            fill
          >
            {PRIORITY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </HTMLSelect>
        </FormGroup>

        <Divider style={{ margin: '16px 0 12px' }} />

        <FormGroup label="Cooldown (minutes)" helperText="Minimum time between firings of this rule">
          <NumericInput
            value={form.cooldown_minutes}
            onValueChange={val => setForm(f => ({ ...f, cooldown_minutes: val }))}
            min={0} max={44640} fill
          />
        </FormGroup>

        {/* ── MITRE ATT&CK ──────────────────────────────────────── */}
        <Divider style={{ margin: '16px 0 12px' }} />
        <p className="bp6-text-muted" style={{ fontSize: 12, marginBottom: 4 }}>MITRE ATT&amp;CK TECHNIQUES</p>
        <p className="bp6-text-muted" style={{ fontSize: 11, marginBottom: 10 }}>
          Tag this rule with relevant ATT&amp;CK techniques for threat intelligence mapping.
        </p>
        <div className="mitre-picker">
          {MITRE_TECHNIQUES.map(t => {
            const selected = form.mitre_tags.includes(t.id)
            return (
              <Tag
                key={t.id}
                interactive
                intent={selected ? 'primary' : 'none'}
                minimal={!selected}
                className="mitre-picker-tag"
                onClick={() =>
                  setForm(f => ({
                    ...f,
                    mitre_tags: selected
                      ? f.mitre_tags.filter(x => x !== t.id)
                      : [...f.mitre_tags, t.id],
                  }))
                }
                title={`${t.tactic}: ${t.name}`}
              >
                {t.id}
              </Tag>
            )
          })}
        </div>
        {form.mitre_tags.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#8a9ba8' }}>
            {form.mitre_tags.map(id => MITRE_BY_ID.get(id)?.name).filter(Boolean).join(' · ')}
          </div>
        )}

        {/* ── EFFECTIVENESS ─────────────────────────────────────── */}
        {editingRule && (() => {
          const eff = effectivenessData?.[editingRule.id]
          if (!eff) return null
          const pct = (r: number | null) => r === null ? '—' : `${Math.round(r * 100)}%`
          return (
            <>
              <Divider style={{ margin: '20px 0 12px' }} />
              <p className="bp6-text-muted" style={{ fontSize: 12, marginBottom: 10 }}>EFFECTIVENESS</p>
              {eff.low_value_flag && (
                <Callout intent="warning" icon="warning-sign" compact
                         style={{ marginBottom: 12, fontSize: 12 }}>
                  Low signal — this rule fires frequently but rarely generates tasks or closed alerts.
                  Consider tightening conditions or raising the proximity threshold.
                </Callout>
              )}
              {eff.sparkline.some(v => v > 0) && (
                <div style={{ marginBottom: 12 }}>
                  <div className="bp6-text-muted" style={{ fontSize: 11, marginBottom: 4 }}>
                    30-day fire trend
                  </div>
                  <RuleSparkline data={eff.sparkline} width="100%" height={40} />
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 12 }}>
                <span className="bp6-text-muted">Total fires</span>
                <span>{eff.total_fires}</span>
                <span className="bp6-text-muted">Last 30 days</span>
                <span>{eff.fires_last_30d}</span>
                <span className="bp6-text-muted">Last 7 days</span>
                <span>{eff.fires_last_7d}</span>
                <span className="bp6-text-muted">Avg confidence</span>
                <span>{eff.avg_confidence !== null ? eff.avg_confidence.toFixed(2) : '—'}</span>
                <span className="bp6-text-muted">Task creation rate</span>
                <span>{pct(eff.task_creation_rate)}</span>
                <span className="bp6-text-muted">Task resolution rate</span>
                <span>{pct(eff.task_resolution_rate)}</span>
                <span className="bp6-text-muted">Alert closure rate</span>
                <span>{pct(eff.alert_closure_rate)}</span>
                {eff.avg_hours_to_ack !== null && (
                  <>
                    <span className="bp6-text-muted">Avg time to ack</span>
                    <span>{eff.avg_hours_to_ack.toFixed(1)}h</span>
                  </>
                )}
              </div>
            </>
          )
        })()}

        <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
          <Button
            intent="primary"
            text={editingRule ? 'Save Changes' : 'Create Rule'}
            loading={isSaving}
            disabled={!form.name.trim()}
            onClick={handleSave}
          />
          <Button text="Cancel" onClick={onClose} />
        </div>
      </div>
    </Drawer>
  )
}
