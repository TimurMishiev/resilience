import { useState, useMemo } from 'react'
import {
  Alert,
  Button,
  ButtonGroup,
  Callout,
  Card,
  Classes,
  Dialog,
  DialogBody,
  Divider,
  Drawer,
  DrawerSize,
  FormGroup,
  HTMLSelect,
  HTMLTable,
  Icon,
  InputGroup,
  NonIdealState,
  NumericInput,
  Spinner,
  Switch,
  Tag,
  TextArea,
} from '@blueprintjs/core'
import { useMutation } from '@tanstack/react-query'
import { useCorrelationRules, useCreateCorrelationRule, useUpdateCorrelationRule, useDeleteCorrelationRule, useRuleEffectiveness } from '../hooks/useCorrelationRules'
import { useSignalRuleMatches } from '../hooks/useSignalRuleMatches'
import { useAreasOfOperation } from '../hooks/useAreasOfOperation'
import { dryRunRule } from '../api/correlation_rules'
import type { DryRunResult } from '../api/correlation_rules'
import { useRole } from '../hooks/useRole'
import type { CorrelationRule, SignalType, TaskPriority, RuleConditions } from '../api/types'
import { isCompoundRule } from '../api/types'
import { RuleSparkline } from '../components/RuleSparkline'
import { humanize } from '../utils/humanize'

const SKELETON_ROWS = 7

const SIGNAL_TYPE_OPTIONS: { value: SignalType; label: string }[] = [
  { value: 'aircraft_position', label: 'Aircraft Position' },
  { value: 'vessel_position',   label: 'Vessel Position'   },
  { value: 'seismic_event',     label: 'Seismic Event'     },
  { value: 'gps_jamming',       label: 'GPS Jamming'       },
  { value: 'wildfire',          label: 'Wildfire'          },
  { value: 'conflict_event',    label: 'Conflict Event'    },
  { value: 'disaster_alert',   label: 'Disaster Alert'    },
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

// ── MITRE ATT&CK techniques ──────────────────────────────────────────────────

interface MitreTechnique {
  id:     string
  name:   string
  tactic: string
}

const MITRE_TECHNIQUES: MitreTechnique[] = [
  { id: 'T1036',  name: 'Masquerading',                      tactic: 'Defense Evasion'      },
  { id: 'T1040',  name: 'Network Sniffing',                  tactic: 'Credential Access'    },
  { id: 'T1498',  name: 'Network Denial of Service',         tactic: 'Impact'               },
  { id: 'T1562',  name: 'Impair Defenses',                   tactic: 'Defense Evasion'      },
  { id: 'T1565',  name: 'Data Manipulation',                 tactic: 'Impact'               },
  { id: 'T1583',  name: 'Acquire Infrastructure',            tactic: 'Resource Development' },
  { id: 'T1590',  name: 'Gather Victim Network Information', tactic: 'Reconnaissance'       },
  { id: 'T1591',  name: 'Gather Victim Org Information',     tactic: 'Reconnaissance'       },
  { id: 'T0826',  name: 'Loss of Availability',              tactic: 'Impact (ICS)'         },
  { id: 'T0827',  name: 'Loss of Control',                   tactic: 'Impact (ICS)'         },
  { id: 'T0879',  name: 'Damage to Property',                tactic: 'Impact (ICS)'         },
  { id: 'T0880',  name: 'Loss of Safety',                    tactic: 'Impact (ICS)'         },
]

const MITRE_BY_ID = new Map(MITRE_TECHNIQUES.map(t => [t.id, t]))

// ── Rule templates ───────────────────────────────────────────────────────────

type TemplateFormState = Omit<Partial<RuleFormState>, 'compound_conditions'> & {
  compound_conditions?: Omit<ConditionRow, '_key'>[]
}

interface RuleTemplate {
  id:          string
  name:        string
  description: string
  icon:        string
  tags:        string[]
  form:        TemplateFormState
}

const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id:   'maritime_deception',
    name: 'Maritime Deception Pattern',
    description:
      'Vessel goes AIS-dark (transponder off) while operating near a site — a classic indicator of covert or illicit maritime activity.',
    icon: 'ship',
    tags: ['Vessel Position', 'AIS Gap', 'compound AND'],
    form: {
      name:              'Maritime Deception Pattern',
      description:       'Vessel goes AIS-dark near site',
      condition_mode:    'compound',
      compound_operator: 'AND',
      compound_conditions: [
        { signal_type: 'vessel_position', proximity_km: 100, magnitude_min: '', count_threshold: 1, time_window_minutes: 60  },
        { signal_type: 'ais_gap',         proximity_km: 100, magnitude_min: '', count_threshold: 1, time_window_minutes: 120 },
      ],
      task_title:       'Maritime deception pattern — {{site_name}}',
      task_description: 'Vessel position followed by AIS gap within {{proximity_km}}km. Review vessel traffic and confirm no covert approach.',
      task_priority:    'high',
      cooldown_minutes: 120,
      mitre_tags:       ['T1036', 'T1565'],
    },
  },
  {
    id:   'electronic_warfare_precursor',
    name: 'Electronic Warfare Precursor',
    description:
      'GPS jamming co-located with aircraft activity — a classic EW precursor pattern used to mask or support air operations.',
    icon: 'satellite',
    tags: ['GPS Jamming', 'Aircraft Position', 'compound AND'],
    form: {
      name:              'Electronic Warfare Precursor',
      description:       'GPS jamming co-located with aircraft activity',
      condition_mode:    'compound',
      compound_operator: 'AND',
      compound_conditions: [
        { signal_type: 'gps_jamming',       proximity_km: 150, magnitude_min: '', count_threshold: 1, time_window_minutes: 60 },
        { signal_type: 'aircraft_position', proximity_km: 150, magnitude_min: '', count_threshold: 1, time_window_minutes: 60 },
      ],
      task_title:       'EW precursor — {{site_name}}',
      task_description: 'GPS jamming and aircraft activity within {{proximity_km}}km. Potential EW precursor. Verify GPS reception and airspace.',
      task_priority:    'critical',
      cooldown_minutes: 60,
      mitre_tags:       ['T1562', 'T0826', 'T1498'],
    },
  },
  {
    id:   'humanitarian_crisis',
    name: 'Humanitarian Crisis Indicator',
    description:
      'A natural disaster alert or armed conflict event near site — triggers a humanitarian response task for any high-consequence signal.',
    icon: 'warning-sign',
    tags: ['Disaster Alert', 'Conflict Event', 'compound OR'],
    form: {
      name:              'Humanitarian Crisis Indicator',
      description:       'Natural disaster or armed conflict detected near site',
      condition_mode:    'compound',
      compound_operator: 'OR',
      compound_conditions: [
        { signal_type: 'disaster_alert', proximity_km: 250, magnitude_min: '', count_threshold: 1, time_window_minutes: 120 },
        { signal_type: 'conflict_event', proximity_km: 200, magnitude_min: '', count_threshold: 1, time_window_minutes: 120 },
      ],
      task_title:       'Crisis event near {{site_name}}',
      task_description: '{{signal_type}} within {{proximity_km}}km. Assess impact on operations and personnel safety.',
      task_priority:    'high',
      cooldown_minutes: 180,
      mitre_tags:       ['T0879', 'T0880'],
    },
  },
  {
    id:   'seismic_threat',
    name: 'Significant Seismic Activity',
    description:
      'Seismic events M4.5 or greater near a site — may indicate infrastructure risk, liquefaction hazard, or secondary effects.',
    icon: 'pulse',
    tags: ['Seismic Event', 'M4.5+', 'simple'],
    form: {
      name:              'Significant Seismic Activity',
      description:       'Earthquake M4.5+ detected near site',
      condition_mode:    'simple',
      signal_type:       'seismic_event',
      proximity_km:      300,
      magnitude_min:     4.5,
      count_threshold:   1,
      time_window_minutes: 30,
      task_title:       'Seismic event near {{site_name}}',
      task_description: 'Magnitude {{magnitude}} seismic event detected {{proximity_km}}km from site. Assess structural integrity and utility services.',
      task_priority:    'high',
      cooldown_minutes: 240,
      mitre_tags:       ['T0879', 'T0880'],
    },
  },
  {
    id:   'air_approach_warning',
    name: 'Air Approach Warning',
    description:
      'Any aircraft within 50 km of a site. Useful for sites requiring continuous airspace awareness or no-fly enforcement.',
    icon: 'airplane',
    tags: ['Aircraft Position', 'simple'],
    form: {
      name:              'Air Approach Warning',
      description:       'Aircraft within 50km of site',
      condition_mode:    'simple',
      signal_type:       'aircraft_position',
      proximity_km:      50,
      magnitude_min:     '',
      count_threshold:   1,
      time_window_minutes: 15,
      task_title:       'Aircraft activity near {{site_name}}',
      task_description: 'Aircraft detected {{proximity_km}}km from {{site_name}}. Monitor for pattern of life or approach vector.',
      task_priority:    'normal',
      cooldown_minutes: 30,
      mitre_tags:       ['T1590', 'T1591'],
    },
  },
  {
    id:   'multi_domain_convergence',
    name: 'Multi-Domain Threat Convergence',
    description:
      'Conflict activity combined with GPS jamming in the same area — combined-arms indicator requiring immediate escalation.',
    icon: 'shield',
    tags: ['Conflict Event', 'GPS Jamming', 'compound AND'],
    form: {
      name:              'Multi-Domain Threat Convergence',
      description:       'Conflict activity with concurrent GPS jamming',
      condition_mode:    'compound',
      compound_operator: 'AND',
      compound_conditions: [
        { signal_type: 'conflict_event', proximity_km: 200, magnitude_min: '', count_threshold: 1, time_window_minutes: 180 },
        { signal_type: 'gps_jamming',   proximity_km: 150, magnitude_min: '', count_threshold: 1, time_window_minutes: 60  },
      ],
      task_title:       'Multi-domain threat — {{site_name}}',
      task_description: 'Conflict event and GPS jamming within {{proximity_km}}km. Possible combined-arms operation. Initiate security posture review.',
      task_priority:    'critical',
      cooldown_minutes: 90,
      mitre_tags:       ['T0827', 'T0880', 'T1562'],
    },
  },
]

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
  _key:                string
  signal_type:         SignalType | ''
  proximity_km:        number
  magnitude_min:       number | ''
  count_threshold:     number
  time_window_minutes: number
}

const DEFAULT_CONDITION: Omit<ConditionRow, '_key'> = {
  signal_type:         '',
  proximity_km:        50,
  magnitude_min:       '',
  count_threshold:     1,
  time_window_minutes: 60,
}

function newCondition(overrides?: Partial<ConditionRow>): ConditionRow {
  return { ...DEFAULT_CONDITION, ...overrides, _key: crypto.randomUUID() }
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
  // MITRE ATT&CK technique IDs
  mitre_tags: string[]
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
  compound_conditions: [newCondition(), newCondition()],
  area_of_operation_id: null,
  mitre_tags: [],
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
    mitre_tags:           rule.mitre_tags ?? [],
  }

  if (isCompoundRule(rule.conditions)) {
    const c = rule.conditions
    return {
      ...DEFAULT_FORM,
      ...base,
      condition_mode:      'compound',
      compound_operator:   c.operator,
      compound_conditions: c.conditions.map(sub => newCondition({
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
        <div key={cond._key} className="compound-condition-row">
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
  const { isCommander } = useRole()

  const { data, error, isPending } = useCorrelationRules()
  const { data: matchesData }      = useSignalRuleMatches({ per_page: 5 })
  const { data: effectivenessData } = useRuleEffectiveness()

  const createMutation = useCreateCorrelationRule()
  const updateMutation = useUpdateCorrelationRule()
  const deleteMutation = useDeleteCorrelationRule()

  const { data: aosData } = useAreasOfOperation()
  const aoList    = aosData?.data ?? []
  const aoByIdMap = useMemo(
    () => new Map((aosData?.data ?? []).map(ao => [ao.id, ao.name])),
    [aosData?.data],
  )

  const [drawerOpen, setDrawerOpen]         = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [editingRule, setEditingRule]       = useState<CorrelationRule | null>(null)
  const [form, setForm]                     = useState<RuleFormState>(DEFAULT_FORM)
  const [deleteTarget, setDeleteTarget] = useState<CorrelationRule | null>(null)
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

  function openFromTemplate(template: RuleTemplate) {
    setEditingRule(null)
    const conditions = (template.form.compound_conditions ?? DEFAULT_FORM.compound_conditions)
      .map(c => newCondition(c))
    setForm({ ...DEFAULT_FORM, ...template.form, compound_conditions: conditions })
    setTemplateDialogOpen(false)
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
      mitre_tags:           form.mitre_tags,
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
    setDeleteTarget(rule)
  }

  function confirmDelete() {
    if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
    setDeleteTarget(null)
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
      compound_conditions: [...f.compound_conditions, newCondition()],
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
      <Alert
        isOpen={deleteTarget !== null}
        intent="danger"
        icon="trash"
        confirmButtonText="Delete"
        cancelButtonText="Cancel"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      >
        <p>Delete rule <strong>{deleteTarget?.name}</strong>? This cannot be undone.</p>
      </Alert>

      <div className="page-header">
        <h2 className="bp6-heading">Correlation Rules</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="bp6-text-muted">
            {isPending
              ? <span className={Classes.SKELETON} style={{ width: 64, display: 'inline-block' }}>&nbsp;</span>
              : `${rules.length} rules`}
          </span>
          {isCommander && (
            <>
              <Button icon="duplicate" small onClick={() => setTemplateDialogOpen(true)}>
                From Template
              </Button>
              <Button icon="plus" intent="primary" small onClick={openCreate}>
                New Rule
              </Button>
            </>
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
              <th>Fires (30d)</th>
              <th>Trend</th>
              <th title="Task rate — fraction of fires that produced a task (proxy for signal actionability)">Task Rate</th>
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
                    <td><span className={Classes.SKELETON} style={{ width: 40, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 80, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 40, display: 'inline-block' }}>&nbsp;</span></td>
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
                        {rule.mitre_tags?.length > 0 && (
                          <div className="mitre-tag-row">
                            {rule.mitre_tags.map(id => (
                              <Tag
                                key={id}
                                minimal
                                className="mitre-table-tag"
                                title={(() => {
                                  const t = MITRE_BY_ID.get(id)
                                  return t ? `${t.id} · ${t.name} [${t.tactic}]` : id
                                })()}
                              >
                                {id}
                              </Tag>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        {isCompoundRule(rule.conditions) ? (
                          <Tag minimal intent="warning">
                            {rule.conditions.operator} · {rule.conditions.conditions.length} signals
                          </Tag>
                        ) : (
                          <Tag minimal intent="primary">
                            {rule.conditions.signal_type ? humanize(rule.conditions.signal_type) : 'any'}
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
                      <td>
                        {(() => {
                          const eff = effectivenessData?.[rule.id]
                          if (!eff) return <span className="bp6-text-muted">—</span>
                          return (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Tag minimal intent={eff.fires_last_30d > 0 ? 'primary' : 'none'}>
                                {eff.fires_last_30d}
                              </Tag>
                              {eff.low_value_flag && (
                                <Icon icon="warning-sign" intent="warning" size={12}
                                      title="Low signal — fires frequently but rarely produces actionable outcomes" />
                              )}
                            </span>
                          )
                        })()}
                      </td>
                      <td style={{ verticalAlign: 'middle', padding: '4px 8px' }}>
                        {(() => {
                          const eff = effectivenessData?.[rule.id]
                          if (!eff || eff.sparkline.every(v => v === 0)) {
                            return <span className="bp6-text-muted" style={{ fontSize: 11 }}>—</span>
                          }
                          return <RuleSparkline data={eff.sparkline} width={80} height={26} />
                        })()}
                      </td>
                      <td>
                        {(() => {
                          const eff = effectivenessData?.[rule.id]
                          if (!eff || eff.task_creation_rate === null) {
                            return <span className="bp6-text-muted">—</span>
                          }
                          const pct = Math.round(eff.task_creation_rate * 100)
                          return (
                            <Tag minimal intent={pct >= 50 ? 'success' : pct >= 20 ? 'warning' : 'danger'}
                                 title="Task rate — fraction of fires that produced a task (proxy for signal actionability)">
                              {pct}%
                            </Tag>
                          )
                        })()}
                      </td>
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

      {/* Template Picker Dialog */}
      <Dialog
        isOpen={templateDialogOpen}
        onClose={() => setTemplateDialogOpen(false)}
        title="Create from Template"
        icon="duplicate"
        style={{ width: 680 }}
      >
        <DialogBody>
          <p className="bp6-text-muted" style={{ marginTop: 0, marginBottom: 16, fontSize: 13 }}>
            Select a pre-built rule template. All fields are editable before saving.
          </p>
          <div className="rule-templates-grid">
            {RULE_TEMPLATES.map(tpl => (
              <Card
                key={tpl.id}
                interactive
                compact
                className="rule-template-card"
                onClick={() => openFromTemplate(tpl)}
              >
                <div className="rule-template-header">
                  <Icon icon={tpl.icon as Parameters<typeof Icon>[0]['icon']} size={16} className="rule-template-icon" />
                  <span className="rule-template-name">{tpl.name}</span>
                </div>
                <p className="rule-template-description">{tpl.description}</p>
                <div className="rule-template-tags">
                  {tpl.tags.map(tag => (
                    <Tag
                      key={tag}
                      minimal
                      intent={
                        tag.includes('compound') ? 'warning'
                        : tag.includes('M') ? 'danger'
                        : 'primary'
                      }
                      style={{ fontSize: 10 }}
                    >
                      {tag}
                    </Tag>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </DialogBody>
      </Dialog>

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
                        <td className="mono">{humanize(m.signal_type)}</td>
                        <td className="mono">{m.source}</td>
                        <td>{m.site_name}</td>
                        <td className="mono">{m.distance_km.toFixed(1)} km</td>
                        <td className="mono">{m.magnitude != null ? Number(m.magnitude).toFixed(1) : '—'}</td>
                        <td>
                          {m.would_fire.map(a => (
                            <Tag key={a} minimal intent="warning" style={{ fontSize: 10, marginRight: 3 }}>
                              {humanize(a)}
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

          {/* ── MITRE ATT&CK ────────────────────────────────────────── */}
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

          {/* ── EFFECTIVENESS ────────────────────────────────────────── */}
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
            <Button text="Cancel" onClick={() => setDrawerOpen(false)} />
          </div>
        </div>
      </Drawer>
    </div>
  )
}
