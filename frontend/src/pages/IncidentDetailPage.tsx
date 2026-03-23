import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  Button, Callout, Classes, EditableText, HTMLSelect, HTMLTable,
  Icon, NonIdealState, Spinner, Tab, Tabs, Tag,
} from '@blueprintjs/core'
import {
  useIncident, useTransitionIncident, useUpdateIncident,
  useIncidentAllowedTransitions, useAssignIncident,
} from '../hooks/useIncidents'
import IntelChainPanel from '../components/IntelChainPanel'
import { useAuth } from '../context/AuthContext'
import { useAssets } from '../hooks/useAssets'
import { useUpdateTask } from '../hooks/useTasks'
import AuditTimeline from '../components/AuditTimeline'
import IncidentNotesPanel from '../components/IncidentNotesPanel'
import IncidentRecommendationsPanel from '../components/IncidentRecommendationsPanel'
import { SIGNAL_ICON_NAME } from '../lib/signalIcons'
import type { IncidentStatus, IncidentSeverity, IncidentAlert, IncidentTask } from '../api/incidents'
import { humanize } from '../utils/humanize'

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

const SEVERITY_OPTIONS: IncidentSeverity[] = ['critical', 'high', 'moderate', 'low']

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// ── sub-components ────────────────────────────────────────────────────────

function AlertsTab({ alerts }: { alerts: IncidentAlert[] }) {
  if (alerts.length === 0) {
    return (
      <NonIdealState
        icon="shield"
        title="No alerts"
        description="No alerts are linked to this incident yet."
        className="tab-empty-state"
      />
    )
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
                  {humanize(a.signal.signal_type)}
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
  const { data: assetRes } = useAssets({ per_page: 200 })
  const updateTask = useUpdateTask()
  const assets = assetRes?.data ?? []

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
          <th>Asset</th>
          <th>Priority</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.id}>
            <td>{t.title}</td>
            <td style={{ minWidth: 140 }}>
              <HTMLSelect
                minimal
                value={t.asset_id ?? ''}
                onChange={e => {
                  const val = e.target.value
                  updateTask.mutate({ id: t.id, body: { asset_id: val || null } })
                }}
                style={{ fontSize: 12, height: 24 }}
              >
                <option value="">— unassigned —</option>
                {assets.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </HTMLSelect>
            </td>
            <td>
              <Tag minimal intent={TASK_PRIORITY_INTENT[t.priority] ?? 'none'} style={{ fontSize: 10 }}>
                {t.priority}
              </Tag>
            </td>
            <td>
              <Tag minimal style={{ fontSize: 10 }}>
                {humanize(t.workflow_status)}
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
  const { currentUser } = useAuth()

  const [tab,          setTab]          = useState('alerts')
  const [editingTitle, setEditingTitle] = useState(false)
  const [editingSev,   setEditingSev]   = useState(false)

  const { data: incident, isPending, error } = useIncident(id)
  const { data: txData } = useIncidentAllowedTransitions(id)
  const transition = useTransitionIncident()
  const updateMut  = useUpdateIncident()
  const assign     = useAssignIncident()

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
  const alerts             = incident.alerts ?? []
  const tasks              = incident.tasks  ?? []
  const isTerminal         = incident.status === 'resolved' || incident.status === 'closed'
  const isAssignedToMe     = currentUser && incident.assigned_to?.id === currentUser.id

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
        {/* Severity — click to edit */}
        {editingSev ? (
          <HTMLSelect
            minimal
            value={incident.severity}
            autoFocus
            onChange={e => {
              updateMut.mutate({ id: incident.id, severity: e.target.value as IncidentSeverity })
              setEditingSev(false)
            }}
            onKeyDown={e => { if (e.key === 'Escape') setEditingSev(false) }}
            style={{ marginRight: 8 }}
          >
            {SEVERITY_OPTIONS.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </HTMLSelect>
        ) : (
          <Tag
            minimal
            intent={SEVERITY_INTENT[incident.severity]}
            style={{ fontWeight: 700, fontSize: 12, marginRight: 8, cursor: 'pointer' }}
            onClick={() => setEditingSev(true)}
            title="Click to change severity"
          >
            {incident.severity}
          </Tag>
        )}

        {/* Title */}
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

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Assignment */}
          <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon icon="person" size={12} className="bp6-text-muted" />
            {incident.assigned_to ? (
              <>
                <span className="bp6-text-muted">{incident.assigned_to.email}</span>
                {isAssignedToMe && <Tag minimal style={{ fontSize: 10, padding: '1px 5px' }}>me</Tag>}
              </>
            ) : (
              <span className="bp6-text-muted">Unassigned</span>
            )}
            {/* Take / Drop */}
            {!isTerminal && currentUser && (
              isAssignedToMe ? (
                <Button
                  small minimal intent="none"
                  loading={assign.isPending}
                  onClick={() => assign.mutate({ id: incident.id, assignee_id: null })}
                  style={{ fontSize: 11, height: 20 }}
                >
                  Drop
                </Button>
              ) : (
                <Button
                  small minimal intent="primary"
                  loading={assign.isPending}
                  onClick={() => assign.mutate({ id: incident.id, assignee_id: currentUser.id })}
                  style={{ fontSize: 11, height: 20 }}
                >
                  Take
                </Button>
              )
            )}
          </span>

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
        {incident.assigned_at && (
          <span className="bp6-text-muted" style={{ fontSize: 12, marginLeft: 12 }}>
            <Icon icon="inherited-group" size={12} style={{ marginRight: 4 }} />
            Assigned {fmt(incident.assigned_at)}
          </span>
        )}
      </div>

      {/* ── status transition buttons ── */}
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
          title={`Evidence (${alerts.length})`}
          panel={<AlertsTab alerts={alerts} />}
        />
        <Tab
          id="tasks"
          title={`Tasks (${tasks.length})`}
          panel={<TasksTab tasks={tasks} />}
        />
        <Tab
          id="recommendations"
          title="Recommendations"
          panel={<IncidentRecommendationsPanel incidentId={incident.id} />}
        />
        <Tab
          id="notes"
          title="Notes"
          panel={<IncidentNotesPanel incidentId={incident.id} />}
        />
        <Tab
          id="chain"
          title="Chain"
          panel={<IntelChainPanel incidentId={incident.id} />}
        />
        <Tab
          id="history"
          title="History"
          panel={
            <AuditTimeline
              entityType="Incident"
              entityId={incident.id}
            />
          }
        />
      </Tabs>
    </div>
  )
}
