import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Callout, HTMLSelect, HTMLTable,
  NonIdealState, Spinner, Tag,
} from '@blueprintjs/core'
import { useIncidents, useTransitionIncident } from '../hooks/useIncidents'
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

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function reltime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60)         return `${Math.round(diff)}s ago`
  if (diff < 3600)       return `${Math.round(diff / 60)}m ago`
  if (diff < 86400)      return `${Math.round(diff / 3600)}h ago`
  return `${Math.round(diff / 86400)}d ago`
}

// ── page ──────────────────────────────────────────────────────────────────

export default function IncidentsPage() {
  const navigate = useNavigate()
  const [statusFilter,   setStatusFilter]   = useState<IncidentStatus | ''>('')
  const [severityFilter, setSeverityFilter] = useState<IncidentSeverity | ''>('')

  const { data, isPending, error } = useIncidents({
    per_page: 50,
    ...(statusFilter   ? { status:   statusFilter }   : {}),
    ...(severityFilter ? { severity: severityFilter } : {}),
  })
  const transition = useTransitionIncident()

  const incidents = data?.data ?? []

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="bp6-heading" style={{ margin: 0 }}>Incidents</h1>
        <span className="bp6-text-muted" style={{ fontSize: 13, marginLeft: 8 }}>
          {data?.meta?.total ?? '—'} total
        </span>
      </div>

      {/* ── filter bar ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
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

        {(statusFilter || severityFilter) && (
          <Button minimal small onClick={() => { setStatusFilter(''); setSeverityFilter('') }}>
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
          description="No incidents match the current filters. Incidents are auto-generated when alerts fire."
        />
      )}

      {!isPending && incidents.length > 0 && (
        <HTMLTable className="data-table" striped interactive>
          <thead>
            <tr>
              <th style={{ width: 90 }}>Severity</th>
              <th>Title</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 60 }}>Alerts</th>
              <th style={{ width: 60 }}>Tasks</th>
              <th>Site</th>
              <th style={{ width: 110 }}>Opened</th>
              <th style={{ width: 120 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {incidents.map((incident: Incident) => {
              const quickTx = STATUS_TRANSITIONS[incident.status]
              return (
                <tr
                  key={incident.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/incidents/${incident.id}`)}
                >
                  <td>
                    <Tag minimal intent={SEVERITY_INTENT[incident.severity]} style={{ fontWeight: 600, fontSize: 11 }}>
                      {incident.severity}
                    </Tag>
                  </td>
                  <td>
                    <span style={{ fontWeight: 500 }}>{incident.title}</span>
                    {incident.fusion_rationale && (
                      <div className="bp6-text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {incident.fusion_rationale.slice(0, 80)}{incident.fusion_rationale.length > 80 ? '…' : ''}
                      </div>
                    )}
                  </td>
                  <td>
                    <Tag minimal intent={STATUS_INTENT[incident.status]} style={{ fontSize: 10 }}>
                      {incident.status}
                    </Tag>
                  </td>
                  <td className="mono" style={{ textAlign: 'center' }}>{incident.alert_count}</td>
                  <td className="mono" style={{ textAlign: 'center' }}>{incident.task_count}</td>
                  <td className="bp6-text-muted" style={{ fontSize: 12 }}>
                    {incident.site?.name ?? '—'}
                  </td>
                  <td className="bp6-text-muted mono" style={{ fontSize: 11 }}>
                    {reltime(incident.opened_at)}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    {quickTx && (
                      <Button
                        small
                        minimal
                        intent={quickTx.to === 'acknowledged' ? 'primary' : quickTx.to === 'contained' ? 'warning' : 'success'}
                        loading={transition.isPending}
                        onClick={() => transition.mutate({ id: incident.id, to_status: quickTx.to })}
                        style={{ fontSize: 11 }}
                      >
                        {quickTx.label}
                      </Button>
                    )}
                    {incident.status === 'resolved' || incident.status === 'closed' ? (
                      <Tag minimal style={{ fontSize: 10 }}>
                        {incident.status === 'closed' ? `Closed ${fmt(incident.closed_at!)}` : `Resolved`}
                      </Tag>
                    ) : null}
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
