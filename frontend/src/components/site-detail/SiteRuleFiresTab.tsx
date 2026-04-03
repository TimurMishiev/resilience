import { Fragment, useState } from 'react'
import { Button, Callout, Checkbox, HTMLTable, Icon, NonIdealState, Spinner, Tag } from '@blueprintjs/core'
import { useSignalRuleMatches, useTransitionAlert, useBulkTransitionAlerts } from '../../hooks/useSignalRuleMatches'
import { useRole } from '../../hooks/useRole'
import { SIGNAL_ICON_NAME } from '../../lib/signalIcons'
import { humanize } from '../../utils/humanize'
import type { AlertStatus, SignalRuleMatch } from '../../api/types'

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

type RuleFireTransition = { label: string; to: AlertStatus; intent: 'primary' | 'warning' | 'none' | 'danger' }

const RULE_FIRE_TRANSITIONS: Record<AlertStatus, RuleFireTransition[]> = {
  unacknowledged: [
    { label: 'Acknowledge', to: 'acknowledged',   intent: 'primary' },
    { label: 'Investigate', to: 'investigating',  intent: 'warning' },
    { label: 'Close',       to: 'closed',         intent: 'none'    },
  ],
  acknowledged: [
    { label: 'Investigate', to: 'investigating',  intent: 'warning' },
    { label: 'Close',       to: 'closed',         intent: 'none'    },
    { label: 'Reopen',      to: 'unacknowledged', intent: 'none'    },
  ],
  investigating: [
    { label: 'Close',       to: 'closed',         intent: 'none'    },
    { label: 'Acknowledge', to: 'acknowledged',   intent: 'primary' },
  ],
  closed: [
    { label: 'Reopen',      to: 'unacknowledged', intent: 'none'    },
    { label: 'Investigate', to: 'investigating',  intent: 'warning' },
  ],
}

const ALERT_STATUS_INTENT_SITE: Record<AlertStatus, 'danger' | 'warning' | 'primary' | 'success'> = {
  unacknowledged: 'danger',
  acknowledged:   'warning',
  investigating:  'primary',
  closed:         'success',
}

const ALERT_STATUS_LABEL_SITE: Record<AlertStatus, string> = {
  unacknowledged: 'New',
  acknowledged:   'Ack',
  investigating:  'Inv',
  closed:         'Done',
}

const SITE_BULK_ACTIONS = [
  { to_status: 'acknowledged', label: 'Acknowledge', intent: 'success'  },
  { to_status: 'investigating', label: 'Investigate', intent: 'warning' },
  { to_status: 'closed',        label: 'Close',       intent: 'danger'  },
] as const

export default function SiteRuleFiresTab({
  siteId,
  isReplaying,
  asOf,
  onChain,
}: {
  siteId: string
  isReplaying: boolean
  asOf?: string | null
  onChain: (m: SignalRuleMatch) => void
}) {
  const { isCommander, isOperator } = useRole()
  const canTriageAlerts = isCommander || isOperator
  const { data, isPending, error } = useSignalRuleMatches(
    { site_id: siteId, per_page: 50, ...(asOf ? { as_of: asOf } : {}) },
    { enabled: true, refetchInterval: isReplaying ? false : 10_000 },
  )
  const transition   = useTransitionAlert()
  const bulkTransition = useBulkTransitionAlerts()
  const [selected, setSelected] = useState<Set<string>>(new Set())

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (error) return <Callout intent="danger" compact>{error.message}</Callout>

  const matches = data?.data ?? []

  if (matches.length === 0) {
    return (
      <NonIdealState
        icon="shield"
        title="No rule fires"
        description="No correlation rules have fired for this site."
        className="tab-empty-state"
      />
    )
  }

  const allIds       = matches.map((m: SignalRuleMatch) => m.id)
  const allChecked   = allIds.length > 0 && allIds.every((id: string) => selected.has(id))
  const someChecked  = allIds.some((id: string) => selected.has(id)) && !allChecked
  const bulkActive   = selected.size > 0

  function toggleAll() {
    if (allChecked) {
      setSelected(new Set())
    } else {
      setSelected(new Set(allIds))
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  function handleBulkAction(to_status: string) {
    bulkTransition.mutate(
      { ids: Array.from(selected), to_status },
      { onSuccess: () => setSelected(new Set()) },
    )
  }

  return (
    <div>
      {isReplaying && (
        <Callout intent="primary" compact style={{ marginBottom: 8 }}>
          Showing rule fires that had fired by the replay timestamp. Triage actions are disabled.
        </Callout>
      )}
      {bulkActive && canTriageAlerts && !isReplaying && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', marginBottom: 4, background: 'var(--bp6-dark-gray3, #383e47)', borderRadius: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.7, marginRight: 4 }}>{selected.size} selected</span>
          {SITE_BULK_ACTIONS.map((a) => (
            <Button
              key={a.to_status}
              small
              intent={a.intent}
              loading={bulkTransition.isPending}
              onClick={() => handleBulkAction(a.to_status)}
            >
              {a.label}
            </Button>
          ))}
          <Button small minimal onClick={() => setSelected(new Set())} style={{ marginLeft: 'auto' }}>
            Clear
          </Button>
        </div>
      )}
      <HTMLTable className="data-table" striped>
        <thead>
          <tr>
            {canTriageAlerts && !isReplaying && (
              <th style={{ width: 32 }}>
                <Checkbox
                  checked={allChecked}
                  indeterminate={someChecked}
                  onChange={toggleAll}
                  style={{ margin: 0 }}
                />
              </th>
            )}
            <th>Rule</th>
            <th>Signal</th>
            <th>Status</th>
            <th>Actions</th>
            <th>Distance</th>
            <th>Fired</th>
            <th style={{ width: 32 }} />
          </tr>
        </thead>
        <tbody>
          {matches.map((m: SignalRuleMatch) => {
            const actions  = (m.metadata?.actions_taken as string[] | undefined) ?? []
            const distKm   = m.metadata?.distance_km as number | undefined
            const status   = (m.workflow_status ?? 'unacknowledged') as AlertStatus
            const txBtns   = RULE_FIRE_TRANSITIONS[status] ?? []
            const isChecked = selected.has(m.id)
            return (
              <Fragment key={m.id}>
                <tr>
                  {canTriageAlerts && !isReplaying && (
                    <td>
                      <Checkbox
                        checked={isChecked}
                        onChange={() => toggleOne(m.id)}
                        style={{ margin: 0 }}
                      />
                    </td>
                  )}
                  <td>
                    {m.correlation_rule
                      ? m.correlation_rule.name
                      : m.metadata?.geofence_breach
                        ? <Tag minimal intent="primary" icon="locate" style={{ fontSize: 10 }}>Geofence breach</Tag>
                        : <span className="bp6-text-muted">—</span>}
                  </td>
                  <td className="mono">
                    {m.signal
                      ? <><Icon icon={SIGNAL_ICON_NAME[m.signal.signal_type] ?? 'dot'} size={12} style={{ marginRight: 5 }} />{humanize(m.signal.signal_type)}</>
                      : <span className="bp6-text-muted">—</span>}
                  </td>
                  <td>
                    <Tag minimal intent={ALERT_STATUS_INTENT_SITE[status] ?? 'none'} style={{ fontSize: 10, fontWeight: 600 }}>
                      {ALERT_STATUS_LABEL_SITE[status] ?? status}
                    </Tag>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {actions.length > 0
                        ? actions.map((a) => (
                            <Tag key={a} minimal intent="warning" style={{ fontSize: 11 }}>
                              {humanize(a)}
                            </Tag>
                          ))
                        : <span className="bp6-text-muted">—</span>}
                    </div>
                  </td>
                  <td className="mono">{distKm != null ? `${Number(distKm).toFixed(1)} km` : '—'}</td>
                  <td className="mono">{fmt(m.fired_at)}</td>
                  <td>
                    <Button
                      icon="data-lineage"
                      minimal
                      small
                      title="View intelligence chain"
                      onClick={(e) => { e.stopPropagation(); onChain(m) }}
                      style={{ minWidth: 0, minHeight: 0 }}
                    />
                  </td>
                </tr>
                {txBtns.length > 0 && !bulkActive && canTriageAlerts && !isReplaying && (
                  <tr key={`${m.id}-tx`} style={{ background: 'transparent' }}>
                    <td colSpan={8} style={{ paddingTop: 2, paddingBottom: 6, border: 'none' }}>
                      <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                        {txBtns.map((btn) => (
                          <Button
                            key={btn.to}
                            small
                            minimal
                            intent={btn.intent}
                            disabled={transition.isPending}
                            onClick={() => transition.mutate({ id: m.id, body: { to_status: btn.to } })}
                            style={{ fontSize: 11 }}
                          >
                            {btn.label}
                          </Button>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </HTMLTable>
    </div>
  )
}
