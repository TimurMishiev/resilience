import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  Button, Callout, Classes, EditableText, HTMLSelect,
  Icon, Spinner, Tab, Tabs, Tag,
} from '@blueprintjs/core'
import {
  useIncident, useTransitionIncident, useUpdateIncident,
  useIncidentAllowedTransitions, useAssignIncident,
} from '../hooks/useIncidents'
import IntelChainPanel from '../components/IntelChainPanel'
import ProsecutionPanel from '../components/ProsecutionPanel'
import IncidentAlertsTab from '../components/incident-detail/IncidentAlertsTab'
import IncidentCompareTab from '../components/incident-detail/IncidentCompareTab'
import IncidentTasksTab from '../components/incident-detail/IncidentTasksTab'
import { PostureBadge } from '../components/PostureBadge'
import { useAuth } from '../context/AuthContext'
import { useReplay } from '../context/ReplayContext'
import { useRole } from '../hooks/useRole'
import AuditTimeline from '../components/AuditTimeline'
import IncidentNotesPanel from '../components/IncidentNotesPanel'
import IncidentRecommendationsPanel from '../components/IncidentRecommendationsPanel'
import type { IncidentStatus, IncidentSeverity } from '../api/incidents'

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

const SEVERITY_OPTIONS: IncidentSeverity[] = ['critical', 'high', 'moderate', 'low']

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// ── main page ─────────────────────────────────────────────────────────────

export default function IncidentDetailPage() {
  const { id }    = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const { currentUser } = useAuth()
  const { isCommander, isOperator } = useRole()
  const { isReplaying, asOf } = useReplay()
  const replayParams = isReplaying && asOf ? { as_of: asOf } : undefined
  const canMutateIncident = isCommander || isOperator

  const [tab,          setTab]          = useState('alerts')
  const [editingTitle, setEditingTitle] = useState(false)
  const [editingSev,   setEditingSev]   = useState(false)

  const { data: incident, isPending, error } = useIncident(id, replayParams, { refetchInterval: isReplaying ? false : 15_000 })
  const { data: txData } = useIncidentAllowedTransitions(id, { enabled: !isReplaying && canMutateIncident, refetchInterval: isReplaying ? false : 15_000 })
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

      {isReplaying && (
        <Callout intent="primary" icon="info-sign" style={{ marginBottom: 12 }}>
          Viewing incident state as it existed at the replay timestamp. Write actions are disabled.
        </Callout>
      )}

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
        {editingSev && canMutateIncident && !isReplaying ? (
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
            style={{ fontWeight: 700, fontSize: 12, marginRight: 8, cursor: canMutateIncident && !isReplaying ? 'pointer' : 'default' }}
            onClick={() => { if (canMutateIncident && !isReplaying) setEditingSev(true) }}
            title={canMutateIncident && !isReplaying ? 'Click to change severity' : undefined}
          >
            {incident.severity}
          </Tag>
        )}

        {/* Title */}
        {editingTitle && canMutateIncident && !isReplaying ? (
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
            style={{ margin: 0, cursor: canMutateIncident && !isReplaying ? 'pointer' : 'default', display: 'inline' }}
            onClick={() => { if (canMutateIncident && !isReplaying) setEditingTitle(true) }}
            title={canMutateIncident && !isReplaying ? 'Click to edit title' : undefined}
          >
            {incident.title}
          </h2>
        )}

        <Tag minimal intent={STATUS_INTENT[incident.status]} style={{ marginLeft: 8, fontSize: 10 }}>
          {incident.status}
        </Tag>

        {/* Prosecution phase badge — shown only when incident is being prosecuted */}
        {incident.prosecution_phase && (
          <Tag
            minimal
            intent={
              incident.prosecution_phase === 'concluded' ? 'success'
                : incident.prosecution_phase === 'executing' ? 'danger'
                : 'warning'
            }
            icon="shield"
            style={{ marginLeft: 4, fontSize: 10 }}
            title={`Prosecution: ${incident.prosecution_phase}`}
          >
            {incident.prosecution_phase}
          </Tag>
        )}

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
            {!isTerminal && !isReplaying && currentUser && canMutateIncident && (
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
        {incident.area_of_operation && (
          <span className="bp6-text-muted" style={{ fontSize: 12, marginLeft: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon icon="area-of-interest" size={12} />
            {incident.area_of_operation.name}
            <PostureBadge posture={incident.area_of_operation.posture} />
          </span>
        )}
      </div>

      {/* ── status transition buttons ── */}
      {allowedTransitions.length > 0 && canMutateIncident && !isReplaying && (
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
          panel={<IncidentAlertsTab alerts={alerts} />}
        />
        <Tab
          id="tasks"
          title={`Tasks (${tasks.length})`}
          panel={<IncidentTasksTab tasks={tasks} posture={incident.area_of_operation?.posture} isReadOnly={isReplaying || !canMutateIncident} asOf={asOf} />}
        />
        <Tab
          id="recommendations"
          title="Recommendations"
          panel={<IncidentRecommendationsPanel incidentId={incident.id} asOf={asOf} isReadOnly={isReplaying} />}
        />
        <Tab
          id="notes"
          title="Notes"
          panel={<IncidentNotesPanel incidentId={incident.id} asOf={asOf} isReadOnly={isReplaying || !canMutateIncident} />}
        />
        <Tab
          id="chain"
          title="Chain"
          panel={<IntelChainPanel incidentId={incident.id} asOf={asOf} />}
        />
        <Tab
          id="history"
          title="History"
          panel={
            <AuditTimeline
              entityType="Incident"
              entityId={incident.id}
              asOf={asOf}
            />
          }
        />
        <Tab
          id="compare"
          title="Compare"
          disabled={isReplaying}
          panel={
            <IncidentCompareTab
              incidentId={incident.id}
              openedAt={incident.opened_at}
              latestAt={incident.updated_at}
            />
          }
        />
        <Tab
          id="prosecution"
          title={
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              Prosecution
              {incident.prosecution_phase && (
                <span style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: incident.prosecution_phase === 'concluded' ? '#22c55e'
                    : incident.prosecution_phase === 'executing' ? '#ef4444'
                    : '#f97316',
                  display: 'inline-block', flexShrink: 0,
                }} />
              )}
            </span>
          }
          panel={<ProsecutionPanel incident={incident} asOf={asOf} />}
        />
      </Tabs>
    </div>
  )
}
