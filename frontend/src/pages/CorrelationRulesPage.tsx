import { useState } from 'react'
import {
  Button,
  ButtonGroup,
  Callout,
  Classes,
  Divider,
  Drawer,
  DrawerSize,
  FormGroup,
  HTMLSelect,
  HTMLTable,
  InputGroup,
  NonIdealState,
  NumericInput,
  Spinner,
  Switch,
  Tag,
  TextArea,
} from '@blueprintjs/core'
import { useMutation } from '@tanstack/react-query'
import { useCorrelationRules, useCreateCorrelationRule, useUpdateCorrelationRule, useDeleteCorrelationRule } from '../hooks/useCorrelationRules'
import { useSignalRuleMatches } from '../hooks/useSignalRuleMatches'
import { useAreasOfOperation } from '../hooks/useAreasOfOperation'
import { dryRunRule } from '../api/correlation_rules'
import type { DryRunResult } from '../api/correlation_rules'
import { useAuth } from '../context/AuthContext'
import type { CorrelationRule, SignalType, TaskPriority, RuleConditions } from '../api/types'
import { isCompoundRule } from '../api/types'

const SKELETON_ROWS = 7

const SIGNAL_TYPE_OPTIONS: { value: SignalType; label: string }[] = [
  { value: 'aircraft_position', label: 'Aircraft Position' },
  { value: 'vessel_position',   label: 'Vessel Position'   },
  { value: 'seismic_event',     label: 'Seismic Event'     },
  { value: 'gps_jamming',       label: 'GPS Jamming'       },
  { value: 'wildfire',          label: 'Wildfire'          },
  { value: 'ais_gap',           label: 'AIS Gap (vessel dark)' },
  { value: 'manual',            label: 'Manual'            },
]

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'low',      label: 'Low'      },
  { value: 'normal',   label: 'Normal'   },
  { value: 'high',     label: 'High'     },
  { value: 'critical', label: 'Critical' },
]

const PRIORITY_INTENTS: Record<TaskPriority, 'none' | 'primary' | 'warning' | 'danger'> = {
  low:      'none',
  normal:   'primary',
  high:     'warning',
  critical: 'danger',
}

function formatLastFired(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60)    return `${Math.floor(diff)}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ── Compound builder types ───────────────────────────────────────────────────

interface ConditionRow {
  signal_type:         SignalType | ''
  proximity_km:        number
  magnitude_min:       number | ''
  count_threshold:     number
  time_window_minutes: number
}

const DEFAULT_CONDITION: ConditionRow = {
  signal_type:         '',
  proximity_km:        50,
  magnitude_min:       '',
  count_threshold:     1,
  time_window_minutes: 60,
}

// ── Form state ───────────────────────────────────────────────────────────────

interface RuleFormState {
  name:                string
  description:         string
  is_active:           boolean
  cooldown_minutes:    number
  task_title:          string
  task_description:    string
  task_priority:       TaskPriority
  // Condition mode
  condition_mode:      'simple' | 'compound'
  // Simple-mode fields (flat condition)
  signal_type:         SignalType | ''
  proximity_km:        number
  magnitude_min:       number | ''
  count_threshold:     number
  time_window_minutes: number
  // Compound-mode fields
  compound_operator:   'AND' | 'OR'
  compound_conditions: ConditionRow[]
  // Scope
  area_of_operation_id: string | null
}

const DEFAULT_FORM: RuleFormState = {
  name:                '',
  description:         '',
  is_active:           true,
  cooldown_minutes:    60,
  task_title:          '',
  task_description:    '',
  task_priority:       'normal',
  condition_mode:      'simple',
  signal_type:         'aircraft_position',
  proximity_km:        50,
  magnitude_min:       '',
  count_threshold:     1,
  time_window_minutes: 10,
  compound_operator:   'AND',
  compound_conditions: [{ ...DEFAULT_CONDITION }, { ...DEFAULT_CONDITION }],
  area_of_operation_id: null,
}

function ruleToForm(rule: CorrelationRule): RuleFormState {
  const a = rule.actions.create_task ?? {}
  const base = {
    name:                 rule.name,
    description:          rule.description ?? '',
    is_active:            rule.is_active,
    cooldown_minutes:     rule.cooldown_minutes,
    task_title:           a.title       ?? '',
    task_description:     a.description ?? '',
    task_priority:        (a.priority as TaskPriority | undefined) ?? 'normal',
    area_of_operation_id: rule.area_of_operation_id,
  }

  if (isCompoundRule(rule.conditions)) {
    const c = rule.conditions
    return {
      ...DEFAULT_FORM,
      ...base,
      condition_mode:      'compound',
      compound_operator:   c.operator,
      compound_conditions: c.conditions.map(sub => ({
        signal_type:         (sub.signal_type as SignalType | undefined) ?? '',
        proximity_km:        sub.proximity_km        ?? 50,
        magnitude_min:       sub.magnitude_min       ?? '',
        count_threshold:     sub.count_threshold     ?? 1,
        time_window_minutes: sub.time_window_minutes ?? 60,
      })),
    }
  }

  const c = rule.conditions
  return {
    ...DEFAULT_FORM,
    ...base,
    condition_mode:      'simple',
    signal_type:         (c.signal_type as SignalType | undefined) ?? 'aircraft_position',
    proximity_km:        c.proximity_km        ?? 50,
    magnitude_min:       c.magnitude_min       ?? '',
    count_threshold:     c.count_threshold     ?? 1,
    time_window_minutes: c.time_window_minutes ?? 10,
  }
}

// ── CompoundBuilder sub-component ────────────────────────────────────────────

interface CompoundBuilderProps {
  operator:   'AND' | 'OR'
  conditions: ConditionRow[]
  onOperatorChange: (op: 'AND' | 'OR') => void
  onConditionChange: (index: number, field: keyof ConditionRow, value: unknown) => void
  onAddCondition:    () => void
  onRemoveCondition: (index: number) => void
}

function CompoundBuilder({
  operator, conditions,
  onOperatorChange, onConditionChange, onAddCondition, onRemoveCondition,
}: CompoundBuilderProps) {
  return (
    <div className="compound-builder">
      {/* Operator toggle */}
      <div className="compound-operator-row">
        <span className="bp6-text-muted" style={{ fontSize: 11, marginRight: 8 }}>MATCH</span>
        <ButtonGroup>
          <Button
            small
            active={operator === 'AND'}
            intent={operator === 'AND' ? 'primary' : 'none'}
            onClick={() => onOperatorChange('AND')}
          >
            ALL of (AND)
          </Button>
          <Button
            small
            active={operator === 'OR'}
            intent={operator === 'OR' ? 'warning' : 'none'}
            onClick={() => onOperatorChange('OR')}
          >
            ANY of (OR)
          </Button>
        </ButtonGroup>
        <span className="bp6-text-muted" style={{ fontSize: 11, marginLeft: 8 }}>
          these conditions
        </span>
      </div>

      {/* Condition rows */}
      {conditions.map((cond, i) => (
        <div key={i} className="compound-condition-row">
          <div className="compound-condition-header">
            <span className="bp6-text-muted" style={{ fontSize: 10, fontWeight: 600 }}>
              CONDITION {i + 1}
            </span>
            <Button
              icon="cross"
              minimal
              small
              disabled={conditions.length <= 2}
              onClick={() => onRemoveCondition(i)}
              title={conditions.length <= 2 ? 'Compound rules need at least 2 conditions' : 'Remove condition'}
            />
          </div>

          <FormGroup label="Signal Type" style={{ marginBottom: 6 }}>
            <HTMLSelect
              value={cond.signal_type}
              onChange={e => onConditionChange(i, 'signal_type', e.target.value)}
              fill
            >
              <option value="">Any signal type</option>
              {SIGNAL_TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </HTMLSelect>
          </FormGroup>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <FormGroup label="Proximity (km)" style={{ marginBottom: 6 }}>
              <NumericInput
                value={cond.proximity_km}
                onValueChange={v => onConditionChange(i, 'proximity_km', v)}
                min={1} max={5000} fill
              />
            </FormGroup>

            <FormGroup label="Min Magnitude" style={{ marginBottom: 6 }}>
              <NumericInput
                value={cond.magnitude_min === '' ? '' : cond.magnitude_min}
                onValueChange={(v, s) => onConditionChange(i, 'magnitude_min', s === '' ? '' : v)}
                min={0} max={10} fill placeholder="—"
              />
            </FormGroup>
          </div>
        </div>
      ))}

      <Button
        icon="plus"
        minimal
        small
        intent="primary"
        onClick={onAddCondition}
        style={{ marginTop: 4 }}
      >
        Add condition
      </Button>

      <Callout intent="primary" compact style={{ marginTop: 12, fontSize: 12 }}>
        {operator === 'AND'
          ? 'All conditions must be met. Non-matching signal types will be looked up from recent DB history.'
          : 'Any single condition is sufficient to fire the rule.'
        }
      </Callout>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CorrelationRulesPage() {
  const { currentUser } = useAuth()
  const isCommander = currentUser?.role === 'commander'

  const { data, error, isPending } = useCorrelationRules()
  const { data: matchesData } = useSignalRuleMatches({ per_page: 5 })

  const createMutation = useCreateCorrelationRule()
  const updateMutation = useUpdateCorrelationRule()
  const deleteMutation = useDeleteCorrelationRule()

  const { data: aosData } = useAreasOfOperation()
  const aoList   = aosData?.data ?? []
  const aoByIdMap = new Map(aoList.map(ao => [ao.id, ao.name]))

  const [drawerOpen, setDrawerOpen]     = useState(false)
  const [editingRule, setEditingRule]   = useState<CorrelationRule | null>(null)
  const [form, setForm]                 = useState<RuleFormState>(DEFAULT_FORM)
  const [dryRunRule_,  setDryRunRule]   = useState<CorrelationRule | null>(null)
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null)
  const [dryRunError,  setDryRunError]  = useState<string | null>(null)
  const [dryRunHours,  setDryRunHours]  = useState(24)

  const dryRunMutation = useMutation({
    mutationFn: ({ id, hours }: { id: string; hours: number }) => dryRunRule(id, hours),
    onSuccess: (result) => { setDryRunResult(result); setDryRunError(null) },
    onError:   (err: Error) => setDryRunError(err.message),
  })

  const rules   = data?.data ?? []
  const matches = matchesData?.data ?? []

  if (error) {
    return (
      <div className="page-content">
        <Callout intent="danger" title="Failed to load correlation rules">
          {error.message}
        </Callout>
      </div>
    )
  }

  if (!isCommander && !isPending && rules.length === 0) {
    return (
      <div className="page-content">
        <NonIdealState
          icon="lock"
          title="No correlation rules"
          description="No correlation rules have been configured yet."
        />
      </div>
    )
  }

  function openCreate() {
    setEditingRule(null)
    setForm(DEFAULT_FORM)
    setDrawerOpen(true)
  }

  function openEdit(rule: CorrelationRule) {
    setEditingRule(rule)
    setForm(ruleToForm(rule))
    setDrawerOpen(true)
  }

  function handleSave() {
    let conditions: RuleConditions

    if (form.condition_mode === 'compound') {
      conditions = {
        operator:   form.compound_operator,
        conditions: form.compound_conditions.map(c => ({
          signal_type:         c.signal_type         || null,
          proximity_km:        c.proximity_km,
          magnitude_min:       c.magnitude_min === '' ? null : c.magnitude_min,
          count_threshold:     c.count_threshold,
          time_window_minutes: c.time_window_minutes,
          site_id:             null,
        })),
      }
    } else {
      conditions = {
        signal_type:         form.signal_type         || null,
        proximity_km:        form.proximity_km,
        magnitude_min:       form.magnitude_min === '' ? null : form.magnitude_min,
        count_threshold:     form.count_threshold,
        time_window_minutes: form.time_window_minutes,
        site_id:             null,
      }
    }

    const payload = {
      name:                 form.name,
      description:          form.description || null,
      is_active:            form.is_active,
      cooldown_minutes:     form.cooldown_minutes,
      area_of_operation_id: form.area_of_operation_id || null,
      conditions,
      actions: {
        create_task: {
          title:       form.task_title,
          description: form.task_description,
          priority:    form.task_priority,
        },
      },
    }

    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, body: payload }, {
        onSuccess: () => setDrawerOpen(false),
      })
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => setDrawerOpen(false),
      })
    }
  }

  function handleDelete(rule: CorrelationRule) {
    if (!window.confirm(`Delete rule "${rule.name}"? This cannot be undone.`)) return
    deleteMutation.mutate(rule.id)
  }

  function updateCompoundCondition(index: number, field: keyof ConditionRow, value: unknown) {
    setForm(f => {
      const updated = f.compound_conditions.map((c, i) =>
        i === index ? { ...c, [field]: value } : c
      )
      return { ...f, compound_conditions: updated }
    })
  }

  function addCompoundCondition() {
    setForm(f => ({
      ...f,
      compound_conditions: [...f.compound_conditions, { ...DEFAULT_CONDITION }],
    }))
  }

  function removeCompoundCondition(index: number) {
    setForm(f => ({
      ...f,
      compound_conditions: f.compound_conditions.filter((_, i) => i !== index),
    }))
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <div className="page-content">
      <div className="page-header">
        <h2 className="bp6-heading">Correlation Rules</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="bp6-text-muted">
            {isPending
              ? <span className={Classes.SKELETON} style={{ width: 64, display: 'inline-block' }}>&nbsp;</span>
              : `${rules.length} rules`}
          </span>
          {isCommander && (
            <Button icon="plus" intent="primary" small onClick={openCreate}>
              New Rule
            </Button>
          )}
        </div>
      </div>

      {!isCommander && (
        <Callout intent="warning" icon="lock" style={{ marginBottom: 16 }}>
          Commander role required to create or modify correlation rules.
        </Callout>
      )}

      {/* Recent rule firings */}
      {matches.length > 0 && (
        <Callout intent="primary" icon="lightning" title="Recent Firings" style={{ marginBottom: 16 }}>
          <ul style={{ margin: 0, padding: '4px 0 0 16px', fontSize: 13 }}>
            {matches.map(m => (
              <li key={m.id}>
                <strong>{m.correlation_rule?.name ?? 'Unknown rule'}</strong>
                {m.site && <> → {m.site.name}</>}
                {m.task && <> · Task: {m.task.title}</>}
                {typeof m.confidence === 'number' && (
                  <Tag minimal style={{ marginLeft: 6, fontSize: 10 }}>
                    {Math.round(m.confidence * 100)}%
                  </Tag>
                )}
                <span className="bp6-text-muted" style={{ marginLeft: 8 }}>
                  {formatLastFired(m.fired_at)}
                </span>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {(isPending || rules.length > 0) && (
        <HTMLTable className="data-table" striped interactive>
          <thead>
            <tr>
              <th>Name</th>
              <th>Conditions</th>
              <th>Proximity</th>
              <th>Triggers</th>
              <th>Active</th>
              <th>Last Fired</th>
              <th>Cooldown</th>
              <th></th>
              {isCommander && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {isPending
              ? Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                  <tr key={i}>
                    <td><span className={Classes.SKELETON} style={{ display: 'block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 96, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 56, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 48, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 48, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 64, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 56, display: 'inline-block' }}>&nbsp;</span></td>
                  </tr>
                ))
              : rules.map(rule => {
                  const actionPriority = (rule.actions.create_task?.priority ?? 'normal') as TaskPriority
                  return (
                    <tr key={rule.id} onClick={() => isCommander && openEdit(rule)}
                        style={{ cursor: isCommander ? 'pointer' : 'default' }}>
                      <td>
                        <div>{rule.name}</div>
                        {rule.description && (
                          <div className="bp6-text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                            {rule.description}
                          </div>
                        )}
                        {rule.area_of_operation_id && (
                          <Tag minimal style={{ marginTop: 4, fontSize: 10 }} icon="geofence">
                            {aoByIdMap.get(rule.area_of_operation_id) ?? 'AO'}
                          </Tag>
                        )}
                      </td>
                      <td>
                        {isCompoundRule(rule.conditions) ? (
                          <Tag minimal intent="warning">
                            {rule.conditions.operator} · {rule.conditions.conditions.length} signals
                          </Tag>
                        ) : (
                          <Tag minimal intent="primary">
                            {rule.conditions.signal_type?.replace(/_/g, ' ') ?? 'any'}
                          </Tag>
                        )}
                      </td>
                      <td className="mono">
                        {!isCompoundRule(rule.conditions) && rule.conditions.proximity_km
                          ? `${rule.conditions.proximity_km}km`
                          : '—'}
                      </td>
                      <td>
                        <Tag minimal intent={PRIORITY_INTENTS[actionPriority]}>
                          {actionPriority} task
                        </Tag>
                      </td>
                      <td>
                        <Tag minimal intent={rule.is_active ? 'success' : 'none'}>
                          {rule.is_active ? 'Active' : 'Inactive'}
                        </Tag>
                      </td>
                      <td className="mono">{formatLastFired(rule.last_fired_at)}</td>
                      <td className="mono">{rule.cooldown_minutes}m</td>
                      <td onClick={e => e.stopPropagation()}>
                        <Button
                          icon="lab-test"
                          minimal small intent="primary"
                          title="Dry run — test against recent signals"
                          onClick={() => {
                            setDryRunRule(rule)
                            setDryRunResult(null)
                            setDryRunError(null)
                            setDryRunHours(24)
                          }}
                        />
                      </td>
                      {isCommander && (
                        <td onClick={e => e.stopPropagation()}>
                          <Button
                            icon="trash" minimal small intent="danger"
                            onClick={() => handleDelete(rule)}
                            loading={deleteMutation.isPending}
                          />
                        </td>
                      )}
                    </tr>
                  )
                })
            }
          </tbody>
        </HTMLTable>
      )}

      {/* Dry Run Drawer */}
      <Drawer
        isOpen={Boolean(dryRunRule_)}
        onClose={() => { setDryRunRule(null); setDryRunResult(null) }}
        title={`Dry Run — ${dryRunRule_?.name ?? ''}`}
        size={DrawerSize.LARGE}
        position="right"
      >
        <div className="drawer-body">
          <p className="bp6-text-muted" style={{ marginTop: 0 }}>
            Simulates this rule against historical signals. No tasks will be created, no sites flagged.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
            <FormGroup label="Look-back window (hours)" style={{ margin: 0 }}>
              <NumericInput
                value={dryRunHours}
                onValueChange={v => setDryRunHours(Math.max(1, Math.min(168, v)))}
                min={1} max={168} style={{ width: 100 }}
              />
            </FormGroup>
            <Button
              intent="primary" icon="play"
              loading={dryRunMutation.isPending}
              onClick={() => dryRunRule_ && dryRunMutation.mutate({ id: dryRunRule_.id, hours: dryRunHours })}
            >
              Run
            </Button>
          </div>

          {dryRunMutation.isPending && <Spinner size={20} />}

          {dryRunError && (
            <Callout intent="danger" compact style={{ marginBottom: 12 }}>{dryRunError}</Callout>
          )}

          {dryRunResult && (
            <>
              <Callout
                intent={dryRunResult.total_matches > 0 ? 'warning' : 'success'}
                style={{ marginBottom: 12 }}
              >
                <strong>{dryRunResult.total_matches} match{dryRunResult.total_matches !== 1 ? 'es' : ''}</strong>
                {' '}would have fired over the last {dryRunResult.window_hours}h.
                {dryRunResult.total_matches > 50 && ' Showing first 50.'}
              </Callout>

              {dryRunResult.matches.length > 0 && (
                <HTMLTable className="data-table" striped style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Signal Type</th><th>Source</th><th>Site</th>
                      <th>Distance</th><th>Magnitude</th><th>Would Fire</th><th>Occurred</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dryRunResult.matches.map((m, i) => (
                      <tr key={i}>
                        <td className="mono">{m.signal_type.replace(/_/g, ' ')}</td>
                        <td className="mono">{m.source}</td>
                        <td>{m.site_name}</td>
                        <td className="mono">{m.distance_km.toFixed(1)} km</td>
                        <td className="mono">{m.magnitude != null ? Number(m.magnitude).toFixed(1) : '—'}</td>
                        <td>
                          {m.would_fire.map(a => (
                            <Tag key={a} minimal intent="warning" style={{ fontSize: 10, marginRight: 3 }}>
                              {a.replace(/_/g, ' ')}
                            </Tag>
                          ))}
                        </td>
                        <td className="mono">
                          {new Date(m.occurred_at).toLocaleString(undefined, {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </HTMLTable>
              )}
            </>
          )}
        </div>
      </Drawer>

      {/* Create / Edit Drawer */}
      <Drawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
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

          {/* ── SCOPE ───────────────────────────────────────────────── */}
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

          {/* ── CONDITIONS ──────────────────────────────────────────── */}
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
                  onValueChange={(val, str) => setForm(f => ({
                    ...f, magnitude_min: str === '' ? '' : val
                  }))}
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

          {/* ── ACTION ──────────────────────────────────────────────── */}
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

          <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
            <Button
              intent="primary"
              text={editingRule ? 'Save Changes' : 'Create Rule'}
              loading={isSaving}
              disabled={!form.name.trim()}
              onClick={handleSave}
            />
            <Button text="Cancel" onClick={() => setDrawerOpen(false)} />
          </div>
        </div>
      </Drawer>
    </div>
  )
}
