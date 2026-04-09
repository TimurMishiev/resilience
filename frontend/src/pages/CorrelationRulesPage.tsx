import { useState, useMemo } from 'react'
import {
  Alert,
  Button,
  Callout,
  Card,
  Classes,
  HTMLTable,
  Icon,
  NonIdealState,
  Tag,
} from '@blueprintjs/core'
import { useCorrelationRules, useDeleteCorrelationRule, useRuleEffectiveness } from '../hooks/useCorrelationRules'
import { useSignalRuleMatches } from '../hooks/useSignalRuleMatches'
import { useAreasOfOperation } from '../hooks/useAreasOfOperation'
import { useRole } from '../hooks/useRole'
import { useReplay } from '../context/ReplayContext'
import type { CorrelationRule, TaskPriority } from '../api/types'
import { isCompoundRule } from '../api/types'
import { RuleSparkline } from '../components/RuleSparkline'
import { humanize } from '../utils/humanize'
import { RuleFormDrawer }     from '../components/correlationRules/RuleFormDrawer'
import { RuleTemplateDialog } from '../components/correlationRules/RuleTemplateDialog'
import { DryRunDrawer }       from '../components/correlationRules/DryRunDrawer'
import { DEFAULT_FORM, formatLastFired, PRIORITY_INTENTS } from '../components/correlationRules/types'
import type { RuleFormState } from '../components/correlationRules/types'

const SKELETON_ROWS = 7

export default function CorrelationRulesPage() {
  const role = useRole()
  const canManageCorrelationRules = role.canManageCorrelationRules ?? role.isCommander
  const { isReplaying, asOf } = useReplay()
  const replayParams = asOf ? { as_of: asOf } : undefined

  const { data, error, isPending } = useCorrelationRules(replayParams)
  const { data: matchesData } = useSignalRuleMatches(
    { per_page: 5, ...(replayParams ?? {}) },
    { refetchInterval: isReplaying ? false : 10000 },
  )
  const { data: effectivenessData } = useRuleEffectiveness({ enabled: !isReplaying })

  const deleteMutation = useDeleteCorrelationRule()

  const { data: aosData } = useAreasOfOperation(replayParams ?? undefined)
  const aoList    = aosData?.data ?? []
  const aoByIdMap = useMemo(
    () => new Map((aosData?.data ?? []).map(ao => [ao.id, ao.name])),
    [aosData?.data],
  )

  // Drawer / dialog visibility
  const [drawerOpen,        setDrawerOpen]        = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [editingRule,       setEditingRule]        = useState<CorrelationRule | null>(null)
  const [formSeed,          setFormSeed]           = useState<RuleFormState>(DEFAULT_FORM)
  const [deleteTarget,      setDeleteTarget]       = useState<CorrelationRule | null>(null)
  const [dryRunTarget,      setDryRunTarget]       = useState<CorrelationRule | null>(null)

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

  if (!canManageCorrelationRules && !isPending && rules.length === 0) {
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
    setFormSeed(DEFAULT_FORM)
    setDrawerOpen(true)
  }

  function openEdit(rule: CorrelationRule) {
    setEditingRule(rule)
    setDrawerOpen(true)
  }

  function handleTemplateSelected(form: RuleFormState) {
    setEditingRule(null)
    setFormSeed(form)
    setDrawerOpen(true)
  }

  function confirmDelete() {
    if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
    setDeleteTarget(null)
  }

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
          {canManageCorrelationRules && !isReplaying && (
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

      {isReplaying && (
        <Callout intent="warning" icon="history" style={{ marginBottom: 16 }}>
          Viewing historical rule definitions and recent firings at the replay timestamp. Analytics and all rule mutations remain live-only.
        </Callout>
      )}

      {!canManageCorrelationRules && (
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

      {/* Rules table */}
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
              {!isReplaying && <th></th>}
              {canManageCorrelationRules && !isReplaying && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {isPending
              ? Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 10 }).map((__, j) => (
                      <td key={j}>
                        <span className={Classes.SKELETON} style={{ display: 'block' }}>&nbsp;</span>
                      </td>
                    ))}
                  </tr>
                ))
              : rules.map(rule => {
                  const actionPriority = (rule.actions.create_task?.priority ?? 'normal') as TaskPriority
                  const eff = isReplaying ? undefined : effectivenessData?.[rule.id]
                  return (
                    <tr key={rule.id} onClick={() => canManageCorrelationRules && !isReplaying && openEdit(rule)}
                        style={{ cursor: canManageCorrelationRules && !isReplaying ? 'pointer' : 'default' }}>
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
                              <Card key={id} className="mitre-table-tag" style={{ display: 'inline-block' }}>
                                <Tag minimal className="mitre-table-tag">{id}</Tag>
                              </Card>
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
                        {eff ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Tag minimal intent={eff.fires_last_30d > 0 ? 'primary' : 'none'}>
                              {eff.fires_last_30d}
                            </Tag>
                            {eff.low_value_flag && (
                              <Icon icon="warning-sign" intent="warning" size={12}
                                    title="Low signal — fires frequently but rarely produces actionable outcomes" />
                            )}
                          </span>
                        ) : <span className="bp6-text-muted">—</span>}
                      </td>
                      <td style={{ verticalAlign: 'middle', padding: '4px 8px' }}>
                        {eff && !eff.sparkline.every(v => v === 0)
                          ? <RuleSparkline data={eff.sparkline} width={80} height={26} />
                          : <span className="bp6-text-muted" style={{ fontSize: 11 }}>—</span>}
                      </td>
                      <td>
                        {eff && eff.task_creation_rate !== null ? (
                          <Tag minimal
                               intent={eff.task_creation_rate >= 0.5 ? 'success' : eff.task_creation_rate >= 0.2 ? 'warning' : 'danger'}
                               title="Task rate — fraction of fires that produced a task">
                            {Math.round(eff.task_creation_rate * 100)}%
                          </Tag>
                        ) : <span className="bp6-text-muted">—</span>}
                      </td>
                      <td className="mono">{rule.cooldown_minutes}m</td>
                      {!isReplaying && (
                        <td onClick={e => e.stopPropagation()}>
                          <Button
                            icon="lab-test"
                            minimal small intent="primary"
                            title="Dry run — test against recent signals"
                            onClick={() => setDryRunTarget(rule)}
                          />
                        </td>
                      )}
                      {canManageCorrelationRules && !isReplaying && (
                        <td onClick={e => e.stopPropagation()}>
                          <Button
                            icon="trash" minimal small intent="danger"
                            onClick={() => setDeleteTarget(rule)}
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

      {/* Dialogs / Drawers */}
      {!isReplaying && (
        <>
          <RuleTemplateDialog
            isOpen={templateDialogOpen}
            onClose={() => setTemplateDialogOpen(false)}
            onSelectTemplate={handleTemplateSelected}
          />

          <DryRunDrawer
            rule={dryRunTarget}
            onClose={() => setDryRunTarget(null)}
          />

          <RuleFormDrawer
            isOpen={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            editingRule={editingRule}
            initialForm={formSeed}
            aoList={aoList}
            effectivenessData={effectivenessData}
          />
        </>
      )}
    </div>
  )
}
