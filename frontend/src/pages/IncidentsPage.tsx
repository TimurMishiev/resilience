import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Callout, Checkbox, HTMLSelect, HTMLTable,
  NonIdealState, Spinner, Tag,
} from '@blueprintjs/core'
import ExportButton from '../components/ExportButton'
import { useIncidents, useTransitionIncident, useAssignIncident } from '../hooks/useIncidents'
import { useReferenceTimeMs } from '../hooks/useReferenceTimeMs'
import { useAuth } from '../context/AuthContext'
import { useReplay } from '../context/ReplayContext'
import { useRole } from '../hooks/useRole'
import type { IncidentStatus, IncidentSeverity, Incident } from '../api/incidents'

// ── constants ─────────────────────────────────────────────────────────────

const SEVERITY_INTENT: Record<IncidentSeverity, 'danger' | 'warning' | 'primary' | 'none'> = {
  critical: 'danger',
  high:     'warning',
  moderate: 'primary',
  low:      'none',
}

const STATUS_INTENT: Record<IncidentStatus, 'danger' | 'warning' | 'primary' | 'success' | 'none'> = {
  open:         'danger',
  acknowledged: 'warning',
  contained:    'primary',
  resolved:     'success',
  closed:       'none',
}

const STATUS_TRANSITIONS: Partial<Record<IncidentStatus, { to: IncidentStatus; label: string }>> = {
  open:         { to: 'acknowledged', label: 'Acknowledge' },
  acknowledged: { to: 'contained',    label: 'Contain' },
  contained:    { to: 'resolved',     label: 'Resolve' },
}

const SEVERITY_ROW_STYLE: Record<IncidentSeverity, CSSProperties> = {
  critical: { borderLeft: '3px solid #c23030' },
  high:     { borderLeft: '3px solid #bf7326' },
  moderate: { borderLeft: '3px solid #2d72d2' },
  low:      { borderLeft: '3px solid rgba(255,255,255,0.12)' },
}

const TX_INTENT: Record<IncidentStatus, 'primary' | 'warning' | 'success' | 'none'> = {
  open:         'none',
  acknowledged: 'primary',
  contained:    'warning',
  resolved:     'success',
  closed:       'none',
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function reltime(iso: string, referenceTimeMs: number) {
  const diff = (referenceTimeMs - new Date(iso).getTime()) / 1000
  if (diff < 60)    return `${Math.round(diff)}s ago`
  if (diff < 3600)  return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  return `${Math.round(diff / 86400)}d ago`
}

// ── page ──────────────────────────────────────────────────────────────────

export default function IncidentsPage() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { isCommander, isOperator } = useRole()
  const { isReplaying, asOf } = useReplay()
  const referenceTimeMs = useReferenceTimeMs(asOf)
  const canMutateIncidents = isCommander || isOperator

  const [statusFilter,   setStatusFilter]   = useState<IncidentStatus | ''>('')
  const [severityFilter, setSeverityFilter] = useState<IncidentSeverity | ''>('')
  const [mineOnly,       setMineOnly]       = useState(false)

  const queryParams = {
    per_page: 50,
    ...(statusFilter   ? { status:   statusFilter }   : {}),
    ...(severityFilter ? { severity: severityFilter } : {}),
    ...(mineOnly && currentUser ? { assigned_to_id: currentUser.id } : {}),
    ...(isReplaying && asOf ? { as_of: asOf } : {}),
  }

  const [pendingTx,     setPendingTx]     = useState<string | null>(null)
  const [pendingAssign, setPendingAssign] = useState<string | null>(null)

  const { data, isPending, error } = useIncidents(queryParams, {
    enabled: true,
    refetchInterval: isReplaying ? false : 15_000,
  })
  const transition = useTransitionIncident({
    onMutate:  ({ id }) => setPendingTx(id),
    onSettled: ()       => setPendingTx(null),
  })
  const assign = useAssignIncident({
    onMutate:  ({ id }) => setPendingAssign(id),
    onSettled: ()       => setPendingAssign(null),
  })

  const incidents     = data?.data ?? []
  const criticalCount = incidents.filter(i => i.severity === 'critical' && i.status !== 'closed').length
  const hasFilters    = !!(statusFilter || severityFilter || mineOnly)

  return (
    <div className="page-content">
      {isReplaying && (
        <Callout intent="primary" icon="history" style={{ marginBottom: 16 }}>
          Showing incidents as they existed at the replay timestamp. Workflow and assignment actions are disabled.
        </Callout>
      )}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 className="bp6-heading" style={{ margin: 0 }}>Incidents</h1>
          {criticalCount > 0 && (
            <Tag intent="danger" round style={{ fontWeight: 700, fontSize: 11 }}>
              {criticalCount} CRITICAL
            </Tag>
          )}
          <span className="bp6-text-muted" style={{ fontSize: 13 }}>
            {data?.meta?.total ?? '—'} {isReplaying ? 'visible' : 'total'}
          </span>
          <ExportButton
            entityType="incidents"
            filters={{
              status: statusFilter || undefined,
              severity: severityFilter || undefined,
            }}
          />
        </div>
      </div>

      {/* ── filter bar ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <HTMLSelect
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as IncidentStatus | '')}
          minimal
          style={{ fontSize: 13 }}
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="contained">Contained</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </HTMLSelect>

        <HTMLSelect
          value={severityFilter}
          onChange={e => setSeverityFilter(e.target.value as IncidentSeverity | '')}
          minimal
          style={{ fontSize: 13 }}
        >
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="moderate">Moderate</option>
          <option value="low">Low</option>
        </HTMLSelect>

        <Checkbox
          label="Mine"
          checked={mineOnly}
          onChange={e => setMineOnly((e.target as HTMLInputElement).checked)}
          style={{ marginBottom: 0, fontSize: 13 }}
        />

        {hasFilters && (
          <Button
            minimal
            small
            onClick={() => { setStatusFilter(''); setSeverityFilter(''); setMineOnly(false) }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {isPending && <Spinner size={24} style={{ marginTop: 24 }} />}
      {error && <Callout intent="danger" compact>{error.message}</Callout>}

      {!isPending && !error && incidents.length === 0 && (
        <NonIdealState
          icon="shield"
          title="No incidents"
          description={
            isReplaying
              ? 'No incidents existed at the selected replay timestamp.'
              : hasFilters
              ? 'No incidents match the current filters.'
              : 'Incidents are auto-generated when correlation rules fire.'
          }
        />
      )}

      {!isPending && incidents.length > 0 && (
        <HTMLTable className="data-table" striped interactive>
          <thead>
            <tr>
              <th style={{ width: 90  }}>Severity</th>
              <th>Title</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 55  }}>Conf.</th>
              <th style={{ width: 55  }}>Alerts</th>
              <th style={{ width: 55  }}>Tasks</th>
              <th>Site</th>
              <th>Assigned</th>
              <th style={{ width: 100 }}>Opened</th>
              <th style={{ width: 170 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {incidents.map((incident: Incident) => {
              const quickTx     = STATUS_TRANSITIONS[incident.status]
              const isAssignedToMe = currentUser && incident.assigned_to?.id === currentUser.id
              const isTerminal  = incident.status === 'resolved' || incident.status === 'closed'

              return (
                <tr
                  key={incident.id}
                  style={{ cursor: 'pointer', ...SEVERITY_ROW_STYLE[incident.severity] }}
                  onClick={() => navigate(`/incidents/${incident.id}`)}
                >
                  <td>
                    <Tag
                      minimal
                      intent={SEVERITY_INTENT[incident.severity]}
                      style={{ fontWeight: 600, fontSize: 11 }}
                    >
                      {incident.severity}
                    </Tag>
                  </td>

                  <td>
                    <span style={{ fontWeight: 500 }}>{incident.title}</span>
                    {incident.fusion_rationale && (
                      <div className="bp6-text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {incident.fusion_rationale.slice(0, 80)}
                        {incident.fusion_rationale.length > 80 ? '…' : ''}
                      </div>
                    )}
                  </td>

                  <td>
                    <Tag minimal intent={STATUS_INTENT[incident.status]} style={{ fontSize: 10 }}>
                      {incident.status}
                    </Tag>
                  </td>

                  <td className="mono" style={{ textAlign: 'center', fontSize: 12 }}>
                    {Math.round(incident.confidence * 100)}%
                  </td>

                  <td className="mono" style={{ textAlign: 'center' }}>{incident.alert_count}</td>
                  <td className="mono" style={{ textAlign: 'center' }}>{incident.task_count}</td>

                  <td className="bp6-text-muted" style={{ fontSize: 12 }}>
                    {incident.site?.name ?? '—'}
                  </td>

                  <td style={{ fontSize: 12 }}>
                    {incident.assigned_to ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span className="bp6-text-muted">{incident.assigned_to.email}</span>
                        {isAssignedToMe && (
                          <Tag minimal style={{ fontSize: 10, padding: '1px 4px' }}>me</Tag>
                        )}
                      </span>
                    ) : (
                      <span className="bp6-text-muted">—</span>
                    )}
                  </td>

                  <td className="bp6-text-muted mono" style={{ fontSize: 11 }}>
                    {reltime(incident.opened_at, referenceTimeMs)}
                  </td>

                  <td onClick={e => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                    {/* Quick status transition */}
                    {quickTx && canMutateIncidents && (
                      <Button
                        small
                        minimal
                        intent={TX_INTENT[quickTx.to]}
                        loading={pendingTx === incident.id}
                        disabled={isReplaying}
                        onClick={() => transition.mutate({ id: incident.id, to_status: quickTx.to })}
                        style={{ fontSize: 11, marginRight: 4 }}
                      >
                        {quickTx.label}
                      </Button>
                    )}

                    {/* Take / Drop ownership */}
                    {!isTerminal && currentUser && canMutateIncidents && !isReplaying && (
                      isAssignedToMe ? (
                        <Button
                          small
                          minimal
                          intent="none"
                          loading={pendingAssign === incident.id}
                          onClick={() => assign.mutate({ id: incident.id, assignee_id: null })}
                          style={{ fontSize: 11 }}
                        >
                          Drop
                        </Button>
                      ) : (
                        <Button
                          small
                          minimal
                          intent="primary"
                          loading={pendingAssign === incident.id}
                          onClick={() => assign.mutate({ id: incident.id, assignee_id: currentUser.id })}
                          style={{ fontSize: 11 }}
                        >
                          Take
                        </Button>
                      )
                    )}

                    {/* Terminal state label */}
                    {isTerminal && (
                      <Tag minimal style={{ fontSize: 10 }}>
                        {incident.status === 'closed' && incident.closed_at
                          ? `Closed ${fmt(incident.closed_at)}`
                          : 'Resolved'}
                      </Tag>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </HTMLTable>
      )}
    </div>
  )
}
