import { useState } from 'react'
import {
  Button,
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
  Switch,
  Tag,
  TextArea,
} from '@blueprintjs/core'
import { useCorrelationRules, useCreateCorrelationRule, useUpdateCorrelationRule, useDeleteCorrelationRule } from '../hooks/useCorrelationRules'
import { useSignalRuleMatches } from '../hooks/useSignalRuleMatches'
import { useAuth } from '../context/AuthContext'
import type { CorrelationRule, SignalType, TaskPriority } from '../api/types'

const SKELETON_ROWS = 7

const SIGNAL_TYPE_OPTIONS: { value: SignalType; label: string }[] = [
  { value: 'aircraft_position', label: 'Aircraft Position' },
  { value: 'vessel_position',   label: 'Vessel Position' },
  { value: 'seismic_event',     label: 'Seismic Event' },
  { value: 'gps_jamming',       label: 'GPS Jamming' },
  { value: 'wildfire',          label: 'Wildfire' },
  { value: 'manual',            label: 'Manual' },
]

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'low',      label: 'Low' },
  { value: 'normal',   label: 'Normal' },
  { value: 'high',     label: 'High' },
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
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

interface RuleFormState {
  name: string
  description: string
  is_active: boolean
  signal_type: SignalType | ''
  proximity_km: number
  magnitude_min: number | ''
  count_threshold: number
  time_window_minutes: number
  cooldown_minutes: number
  task_title: string
  task_description: string
  task_priority: TaskPriority
}

const DEFAULT_FORM: RuleFormState = {
  name:                '',
  description:         '',
  is_active:           true,
  signal_type:         'aircraft_position',
  proximity_km:        50,
  magnitude_min:       '',
  count_threshold:     1,
  time_window_minutes: 10,
  cooldown_minutes:    60,
  task_title:          '',
  task_description:    '',
  task_priority:       'normal',
}

function ruleToForm(rule: CorrelationRule): RuleFormState {
  const c = rule.conditions
  const a = rule.actions.create_task ?? {}
  return {
    name:                rule.name,
    description:         rule.description ?? '',
    is_active:           rule.is_active,
    signal_type:         (c.signal_type as SignalType | undefined) ?? 'aircraft_position',
    proximity_km:        c.proximity_km ?? 50,
    magnitude_min:       c.magnitude_min ?? '',
    count_threshold:     c.count_threshold ?? 1,
    time_window_minutes: c.time_window_minutes ?? 10,
    cooldown_minutes:    rule.cooldown_minutes,
    task_title:          a.title ?? '',
    task_description:    a.description ?? '',
    task_priority:       (a.priority as TaskPriority | undefined) ?? 'normal',
  }
}

export default function CorrelationRulesPage() {
  const { currentUser } = useAuth()
  const isCommander = currentUser?.role === 'commander'

  const { data, error, isPending } = useCorrelationRules()
  const { data: matchesData } = useSignalRuleMatches({ per_page: 5 })

  const createMutation = useCreateCorrelationRule()
  const updateMutation = useUpdateCorrelationRule()
  const deleteMutation = useDeleteCorrelationRule()

  const [drawerOpen, setDrawerOpen]   = useState(false)
  const [editingRule, setEditingRule] = useState<CorrelationRule | null>(null)
  const [form, setForm]               = useState<RuleFormState>(DEFAULT_FORM)

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
    const payload = {
      name:             form.name,
      description:      form.description || null,
      is_active:        form.is_active,
      cooldown_minutes: form.cooldown_minutes,
      conditions: {
        signal_type:         form.signal_type || null,
        proximity_km:        form.proximity_km,
        magnitude_min:       form.magnitude_min === '' ? null : form.magnitude_min,
        count_threshold:     form.count_threshold,
        time_window_minutes: form.time_window_minutes,
        site_id:             null,
      },
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
              <th>Signal Type</th>
              <th>Proximity</th>
              <th>Triggers</th>
              <th>Active</th>
              <th>Last Fired</th>
              <th>Cooldown</th>
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
                      </td>
                      <td>
                        <Tag minimal intent="primary">
                          {rule.conditions.signal_type ?? 'any'}
                        </Tag>
                      </td>
                      <td className="mono">
                        {rule.conditions.proximity_km ? `${rule.conditions.proximity_km}km` : '—'}
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
                      {isCommander && (
                        <td onClick={e => e.stopPropagation()}>
                          <Button
                            icon="trash"
                            minimal
                            small
                            intent="danger"
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
              fill
              rows={2}
              placeholder="Optional description..."
            />
          </FormGroup>

          <Switch
            checked={form.is_active}
            onChange={e => setForm(f => ({ ...f, is_active: (e.target as HTMLInputElement).checked }))}
            label="Active"
          />

          <Divider style={{ margin: '16px 0 12px' }} />
          <p className="bp6-text-muted" style={{ fontSize: 12, marginBottom: 12 }}>CONDITIONS</p>

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
