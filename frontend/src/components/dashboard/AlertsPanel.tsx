import { useState } from 'react'
import { Button, Checkbox, Icon, Tag, Tooltip } from '@blueprintjs/core'
import { useNavigate } from 'react-router-dom'
import AlertChainDrawer from '../AlertChainDrawer'
import { useTransitionAlert, useBulkTransitionAlerts } from '../../hooks/useSignalRuleMatches'
import { SIGNAL_ICON_NAME } from '../../lib/signalIcons'
import { COLORS } from '../../lib/colors'
import { humanize } from '../../utils/humanize'
import type { SignalRuleMatch, AlertStatus } from '../../api/types'

function confidenceColor(c: number): string {
  if (c >= 0.85) return COLORS.success
  if (c >= 0.65) return COLORS.warning
  if (c >= 0.40) return COLORS.orange
  return COLORS.danger
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  unacknowledged: 'New',
  acknowledged:   'Ack',
  investigating:  'Inv',
  closed:         'Done',
}

const ALERT_STATUS_INTENT: Record<AlertStatus, 'danger' | 'warning' | 'primary' | 'success'> = {
  unacknowledged: 'danger',
  acknowledged:   'warning',
  investigating:  'primary',
  closed:         'success',
}

type AlertTransition = { label: string; to: AlertStatus; intent: 'primary' | 'warning' | 'none' | 'danger' }

const ALERT_TRANSITIONS: Record<AlertStatus, AlertTransition[]> = {
  unacknowledged: [
    { label: 'Acknowledge', to: 'acknowledged',  intent: 'primary' },
    { label: 'Investigate', to: 'investigating', intent: 'warning' },
    { label: 'Close',       to: 'closed',        intent: 'none'    },
  ],
  acknowledged: [
    { label: 'Investigate', to: 'investigating', intent: 'warning' },
    { label: 'Close',       to: 'closed',        intent: 'none'    },
    { label: 'Reopen',      to: 'unacknowledged', intent: 'none'   },
  ],
  investigating: [
    { label: 'Close',       to: 'closed',        intent: 'none'    },
    { label: 'Acknowledge', to: 'acknowledged',  intent: 'primary' },
  ],
  closed: [
    { label: 'Reopen',      to: 'unacknowledged', intent: 'none'   },
    { label: 'Investigate', to: 'investigating', intent: 'warning' },
  ],
}

const BULK_ACTIONS = [
  { to_status: 'acknowledged', label: 'Acknowledge', intent: 'success'  },
  { to_status: 'investigating', label: 'Investigate', intent: 'warning'  },
  { to_status: 'closed',        label: 'Close',       intent: 'danger'   },
] as const

export default function AlertsPanel({ matches }: { matches: SignalRuleMatch[] }) {
  const navigate    = useNavigate()
  const transition  = useTransitionAlert()
  const bulkMutate  = useBulkTransitionAlerts()
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [chainMatch, setChainMatch] = useState<SignalRuleMatch | null>(null)

  if (matches.length === 0) {
    return <p className="bp6-text-muted" style={{ fontSize: 13, margin: 0 }}>No rule fires recorded yet.</p>
  }

  const allIds      = matches.map(m => m.id)
  const allSelected = selected.size === matches.length
  const someSelected = selected.size > 0

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds))
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  function handleBulk(to_status: string) {
    bulkMutate.mutate(
      { ids: Array.from(selected), to_status },
      { onSuccess: () => setSelected(new Set()) }
    )
  }

  return (
    <div className="alerts-list">
      {/* Bulk action toolbar — shown when any alerts are selected */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, minHeight: 28 }}>
        <Checkbox
          checked={allSelected}
          indeterminate={someSelected && !allSelected}
          onChange={toggleAll}
          style={{ margin: 0 }}
        />
        {someSelected ? (
          <>
            <span style={{ fontSize: 12, color: COLORS.muted }}>{selected.size} selected</span>
            {BULK_ACTIONS.map(action => (
              <Button
                key={action.to_status}
                small minimal
                intent={action.intent as 'success' | 'warning' | 'danger'}
                loading={bulkMutate.isPending}
                onClick={() => handleBulk(action.to_status)}
                style={{ fontSize: 11 }}
              >
                {action.label}
              </Button>
            ))}
            <Button small minimal onClick={() => setSelected(new Set())} style={{ fontSize: 11 }}>
              Clear
            </Button>
          </>
        ) : (
          <span style={{ fontSize: 12, color: COLORS.subtle }}>Select alerts to bulk-triage</span>
        )}
      </div>

      {matches.map((m) => {
        const actions  = (m.metadata?.actions_taken as string[] | undefined) ?? []
        const hasFlag  = actions.some((a) => a.includes('flag'))
        const hasTask  = actions.some((a) => a.includes('task'))
        const distKm   = m.metadata?.distance_km as number | undefined
        const intent   = hasFlag ? 'danger' : hasTask ? 'warning' : 'none'
        const status   = (m.workflow_status ?? 'unacknowledged') as AlertStatus
        const conf     = typeof m.confidence === 'number' ? m.confidence : null
        const txBtns   = ALERT_TRANSITIONS[status] ?? []
        const isChecked = selected.has(m.id)

        return (
          <div key={m.id} className={`alert-row alert-row--${intent}${isChecked ? ' alert-row--selected' : ''}`}>
            {/* Main card body */}
            <div
              className="alert-row-main"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              {/* Checkbox — stops click propagation so it doesn't trigger navigation */}
              <div onClick={e => e.stopPropagation()} style={{ paddingRight: 6 }}>
                <Checkbox checked={isChecked} onChange={() => toggleOne(m.id)} style={{ margin: 0 }} />
              </div>

              <div
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                         cursor: m.site?.id ? 'pointer' : 'default' }}
                onClick={() => m.site?.id && navigate(`/sites/${m.site.id}`)}
              >
                <div className="alert-row-left">
                  <span className="alert-signal-icon">
                    {m.signal
                      ? <Icon icon={SIGNAL_ICON_NAME[m.signal.signal_type] ?? 'dot'} size={14} />
                      : <Icon icon="dot" size={14} />}
                  </span>
                  <div className="alert-body">
                    <span className="alert-rule-name">
                      {m.correlation_rule?.name ?? (
                        m.metadata?.geofence_breach
                          ? <Tag minimal intent="primary" icon="locate" style={{ fontSize: 10 }}>Geofence breach</Tag>
                          : 'Unknown rule'
                      )}
                    </span>
                    {m.site && (
                      <span className="alert-site bp6-text-muted">@ {m.site.name}</span>
                    )}
                  </div>
                </div>
                <div className="alert-row-right">
                  <div className="alert-actions">
                    <Tag minimal intent={ALERT_STATUS_INTENT[status] ?? 'none'}
                         style={{ fontSize: 10, fontWeight: 600 }}>
                      {ALERT_STATUS_LABEL[status] ?? status}
                    </Tag>
                    {conf != null && (
                      <Tooltip content={`Match confidence: ${Math.round(conf * 100)}%`} placement="top">
                        <span className="alert-confidence"
                              style={{ color: confidenceColor(conf), fontSize: 11, fontWeight: 600, cursor: 'default' }}>
                          {Math.round(conf * 100)}%
                        </span>
                      </Tooltip>
                    )}
                    {actions.map((a) => (
                      <Tag key={a} minimal intent={hasFlag ? 'danger' : 'warning'} style={{ fontSize: 10 }}>
                        {humanize(a)}
                      </Tag>
                    ))}
                    {distKm != null && (
                      <span className="bp6-text-muted" style={{ fontSize: 11 }}>{Number(distKm).toFixed(0)} km</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span className="alert-time bp6-text-muted">{fmtTime(m.fired_at)}</span>
                    <Button
                      icon="data-lineage"
                      minimal
                      small
                      title="View intelligence chain"
                      onClick={e => { e.stopPropagation(); setChainMatch(m) }}
                      style={{ minWidth: 0, minHeight: 0, opacity: 0.6 }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Inline single-alert transition row — hidden when bulk selection is active */}
            {txBtns.length > 0 && !someSelected && (
              <div className="alert-row-transitions" onClick={e => e.stopPropagation()}
                   style={{ display: 'flex', gap: 4, padding: '4px 8px 6px 46px' }}>
                {txBtns.map((btn) => (
                  <Button key={btn.to} small minimal intent={btn.intent}
                          disabled={transition.isPending}
                          onClick={() => transition.mutate({ id: m.id, body: { to_status: btn.to } })}
                          style={{ fontSize: 11 }}>
                    {btn.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <AlertChainDrawer match={chainMatch} onClose={() => setChainMatch(null)} />
    </div>
  )
}
