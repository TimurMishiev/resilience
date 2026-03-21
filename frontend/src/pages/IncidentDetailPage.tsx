import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  Button, Callout, Classes, EditableText, HTMLTable,
  Icon, NonIdealState, Spinner, Tab, Tabs, Tag,
} from '@blueprintjs/core'
import { useIncident, useTransitionIncident, useUpdateIncident, useIncidentAllowedTransitions } from '../hooks/useIncidents'
import { SIGNAL_ICON_NAME } from '../lib/signalIcons'
import type { IncidentStatus, IncidentSeverity, IncidentAlert, IncidentTask } from '../api/incidents'

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

const TRANSITION_INTENT: Record<IncidentStatus, 'primary' | 'warning' | 'success' | 'danger' | 'none'> = {
  open:         'danger',
  acknowledged: 'warning',
  contained:    'primary',
  resolved:     'success',
  closed:       'none',
}

const ALERT_STATUS_INTENT: Record<string, 'danger' | 'warning' | 'primary' | 'success' | 'none'> = {
  unacknowledged: 'danger',
  acknowledged:   'warning',
  investigating:  'primary',
  closed:         'success',
}

const TASK_PRIORITY_INTENT: Record<string, 'danger' | 'warning' | 'primary' | 'none'> = {
  critical: 'danger',
  high:     'warning',
  normal:   'primary',
  low:      'none',
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// ── sub-components ────────────────────────────────────────────────────────

function AlertsTab({ alerts }: { alerts: IncidentAlert[] }) {
  if (alerts.length === 0) {
    return <NonIdealState icon="shield" title="No alerts" className="tab-empty-state" />
  }
  return (
    <HTMLTable className="data-table" striped>
      <thead>
        <tr>
          <th>Rule / Source</th>
          <th>Signal</th>
          <th>Status</th>
          <th>Confidence</th>
          <th>Fired</th>
        </tr>
      </thead>
      <tbody>
        {alerts.map((a) => (
          <tr key={a.id}>
            <td>
              {a.geofence_breach
                ? <Tag minimal intent="primary" icon="locate" style={{ fontSize: 10 }}>Geofence breach</Tag>
                : <span>{a.correlation_rule?.name ?? <span className="bp6-text-muted">—</span>}</span>}
            </td>
            <td className="mono" style={{ fontSize: 12 }}>
              {a.signal ? (
                <>
                  <Icon icon={SIGNAL_ICON_NAME[a.signal.signal_type] ?? 'dot'} size={12} style={{ marginRight: 5 }} />
                  {a.signal.signal_type.replace(/_/g, ' ')}
                </>
              ) : <span className="bp6-text-muted">—</span>}
            </td>
            <td>
              <Tag minimal intent={ALERT_STATUS_INTENT[a.workflow_status] ?? 'none'} style={{ fontSize: 10 }}>
                {a.workflow_status}
              </Tag>
            </td>
            <td className="mono">{Math.round(a.confidence * 100)}%</td>
            <td className="mono" style={{ fontSize: 11 }}>{fmt(a.fired_at)}</td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}

function TasksTab({ tasks }: { tasks: IncidentTask[] }) {
  if (tasks.length === 0) {
    return (
      <NonIdealState
        icon="clipboard"
        title="No tasks"
        description="No tasks have been generated from the alerts in this incident."
        className="tab-empty-state"
      />
    )
  }
  return (
    <HTMLTable className="data-table" striped>
      <thead>
        <tr>
          <th>Title</th>
          <th>Priority</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.id}>
            <td>{t.title}</td>
            <td>
              <Tag minimal intent={TASK_PRIORITY_INTENT[t.priority] ?? 'none'} style={{ fontSize: 10 }}>
                {t.priority}
              </Tag>
            </td>
            <td>
              <Tag minimal style={{ fontSize: 10 }}>
                {t.workflow_status.replace(/_/g, ' ')}
              </Tag>
            </td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}

// ── main page ─────────────────────────────────────────────────────────────

export default function IncidentDetailPage() {
  const { id }    = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const [tab, setTab] = useState('alerts')
  const [editingTitle, setEditingTitle] = useState(false)

  const { data: incident, isPending, error } = useIncident(id)
  const { data: txData } = useIncidentAllowedTransitions(id)
  const transition  = useTransitionIncident()
  const updateMut   = useUpdateIncident()

  if (isPending) {
    return (
      <div className="page-content">
        <div className="page-header">
          <span className={Classes.SKELETON} style={{ width: 280, height: 24, display: 'inline-block' }} />
        </div>
        <Spinner size={24} />
      </div>
    )
  }

  if (error || !incident) {
    return (
      <div className="page-content">
        <Callout intent="danger" title="Failed to load incident">
          {error?.message ?? 'Incident not found'}
        </Callout>
      </div>
    )
  }

  const allowedTransitions = txData?.allowed ?? []
  const alerts = incident.alerts ?? []
  const tasks  = incident.tasks  ?? []

  function handleTitleConfirm(value: string) {
    if (value.trim() && value !== incident!.title) {
      updateMut.mutate({ id: incident!.id, title: value.trim() })
    }
    setEditingTitle(false)
  }

  return (
    <div className="page-content site-detail">

      {/* ── breadcrumb ── */}
      <div style={{ marginBottom: 8 }}>
        <Button icon="arrow-left" minimal small onClick={() => navigate('/incidents')} style={{ marginRight: 4 }} />
        <Link to="/incidents" className="bp6-text-muted" style={{ fontSize: 13 }}>Incidents</Link>
        <span className="bp6-text-muted" style={{ fontSize: 13, margin: '0 6px' }}>›</span>
        <span style={{ fontSize: 13 }}>{incident.title}</span>
      </div>

      {/* ── header ── */}
      <div className="site-detail-header">
        <Tag
          minimal
          intent={SEVERITY_INTENT[incident.severity]}
          style={{ fontWeight: 700, fontSize: 12, marginRight: 8 }}
        >
          {incident.severity}
        </Tag>

        {editingTitle ? (
          <EditableText
            defaultValue={incident.title}
            isEditing
            onConfirm={handleTitleConfirm}
            onCancel={() => setEditingTitle(false)}
            className="bp6-heading"
          />
        ) : (
          <h2
            className="bp6-heading"
            style={{ margin: 0, cursor: 'pointer', display: 'inline' }}
            onClick={() => setEditingTitle(true)}
            title="Click to edit title"
          >
            {incident.title}
          </h2>
        )}

        <Tag minimal intent={STATUS_INTENT[incident.status]} style={{ marginLeft: 8, fontSize: 10 }}>
          {incident.status}
        </Tag>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="bp6-text-muted" style={{ fontSize: 12 }}>
            {Math.round(incident.confidence * 100)}% conf ·{' '}
            {incident.alert_count} alert{incident.alert_count !== 1 ? 's' : ''} ·{' '}
            {incident.task_count} task{incident.task_count !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* ── meta row ── */}
      <div className="site-detail-meta" style={{ marginBottom: 12 }}>
        <span className="bp6-text-muted" style={{ fontSize: 12 }}>
          <Icon icon="time" size={12} style={{ marginRight: 4 }} />
          Opened {fmt(incident.opened_at)}
          {incident.acknowledged_at && ` · Acknowledged ${fmt(incident.acknowledged_at)}`}
          {incident.closed_at && ` · Closed ${fmt(incident.closed_at)}`}
        </span>
        {incident.site && (
          <span className="bp6-text-muted" style={{ fontSize: 12, marginLeft: 12 }}>
            <Icon icon="map-marker" size={12} style={{ marginRight: 4 }} />
            <Link to={`/sites/${incident.site.id}`} style={{ color: 'inherit' }}>
              {incident.site.name}
            </Link>
          </span>
        )}
      </div>

      {/* ── transition buttons ── */}
      {allowedTransitions.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {allowedTransitions.map((to) => (
            <Button
              key={to}
              small
              intent={TRANSITION_INTENT[to] ?? 'none'}
              loading={transition.isPending}
              onClick={() => transition.mutate({ id: incident.id, to_status: to })}
            >
              → {to.charAt(0).toUpperCase() + to.slice(1)}
            </Button>
          ))}
        </div>
      )}

      {/* ── fusion rationale ── */}
      {incident.fusion_rationale && (
        <Callout
          icon="data-lineage"
          compact
          style={{ marginBottom: 16, fontSize: 12 }}
        >
          <strong>Fusion rationale: </strong>{incident.fusion_rationale}
        </Callout>
      )}

      {/* ── tabs ── */}
      <Tabs
        id="incident-tabs"
        selectedTabId={tab}
        onChange={(t) => setTab(String(t))}
        className="site-detail-tabs"
      >
        <Tab
          id="alerts"
          title={`Alerts (${alerts.length})`}
          panel={<AlertsTab alerts={alerts} />}
        />
        <Tab
          id="tasks"
          title={`Tasks (${tasks.length})`}
          panel={<TasksTab tasks={tasks} />}
        />
      </Tabs>
    </div>
  )
}
