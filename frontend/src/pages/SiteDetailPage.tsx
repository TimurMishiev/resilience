import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Button,
  Callout,
  Checkbox,
  Classes,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
  HTMLSelect,
  HTMLTable,
  Icon,
  InputGroup,
  NonIdealState,
  Spinner,
  Tab,
  Tabs,
  Tag,
  TextArea,
} from '@blueprintjs/core'
import { useSite, useUnflagSite, useToggleSiteStatus } from '../hooks/useSite'
import { useTasks, useCreateTask } from '../hooks/useTasks'
import { useSignals } from '../hooks/useSignals'
import { useSignalRuleMatches, useTransitionAlert, useBulkTransitionAlerts } from '../hooks/useSignalRuleMatches'
import { useAssets } from '../hooks/useAssets'
import { useReadiness } from '../hooks/useReadiness'
import AuditTimeline from '../components/AuditTimeline'
import SiteTimeline from '../components/SiteTimeline'
import RiskScoreChart from '../components/RiskScoreChart'
import { SIGNAL_ICON_NAME } from '../lib/signalIcons'
import type { TaskPriority, AlertStatus } from '../api/types'
import type { Task, Signal, SignalRuleMatch, Asset } from '../api/types'

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const PRIORITY_INTENT: Record<string, 'danger' | 'warning' | 'primary' | 'none'> = {
  critical: 'danger', high: 'warning', normal: 'primary', low: 'none',
}

const STATUS_INTENT: Record<string, 'success' | 'warning' | 'danger' | 'none' | 'primary'> = {
  resolved: 'success', blocked: 'danger', in_progress: 'primary', triaged: 'warning', new: 'none',
}


// ── sub-panels ────────────────────────────────────────────────────────────────

function TasksTab({ siteId }: { siteId: string }) {
  const { data, isPending, error } = useTasks({ site_id: siteId, per_page: 50 })

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (error) return <Callout intent="danger" compact>{error.message}</Callout>

  const tasks = data?.data ?? []

  if (tasks.length === 0) {
    return (
      <NonIdealState
        icon="tick-circle"
        title="No tasks"
        description="No tasks linked to this site."
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
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t: Task) => (
          <tr key={t.id}>
            <td>{t.title}</td>
            <td>
              <Tag minimal intent={PRIORITY_INTENT[t.priority] ?? 'none'}>
                {t.priority}
              </Tag>
            </td>
            <td>
              <Tag minimal intent={STATUS_INTENT[t.workflow_status] ?? 'none'}>
                {t.workflow_status.replace('_', ' ')}
              </Tag>
            </td>
            <td className="mono">{fmt(t.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}

function SignalsTab({ siteId }: { siteId: string }) {
  const { data, isPending, error } = useSignals({ site_id: siteId, per_page: 50 })

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (error) return <Callout intent="danger" compact>{error.message}</Callout>

  const signals = data?.data ?? []

  if (signals.length === 0) {
    return (
      <NonIdealState
        icon="signal-search"
        title="No signals"
        description="No signals detected near this site."
        className="tab-empty-state"
      />
    )
  }

  return (
    <HTMLTable className="data-table" striped>
      <thead>
        <tr>
          <th>Type</th>
          <th>Source</th>
          <th>Magnitude</th>
          <th>Lat / Lng</th>
          <th>Occurred</th>
        </tr>
      </thead>
      <tbody>
        {signals.map((s: Signal) => (
          <tr key={s.id}>
            <td>
              <Icon icon={SIGNAL_ICON_NAME[s.signal_type] ?? 'dot'} size={12} style={{ marginRight: 6 }} />
              {s.signal_type.replace(/_/g, ' ')}
            </td>
            <td className="mono">{s.source}</td>
            <td className="mono">{s.magnitude != null ? Number(s.magnitude).toFixed(2) : '—'}</td>
            <td className="mono">
              {Number(s.lat).toFixed(3)}, {Number(s.lng).toFixed(3)}
            </td>
            <td className="mono">{fmt(s.occurred_at)}</td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
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

function RuleFiresTab({ siteId }: { siteId: string }) {
  const { data, isPending, error } = useSignalRuleMatches({ site_id: siteId, per_page: 50 })
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
      {bulkActive && (
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
            <th style={{ width: 32 }}>
              <Checkbox
                checked={allChecked}
                indeterminate={someChecked}
                onChange={toggleAll}
                style={{ margin: 0 }}
              />
            </th>
            <th>Rule</th>
            <th>Signal</th>
            <th>Status</th>
            <th>Actions</th>
            <th>Distance</th>
            <th>Fired</th>
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
              <>
                <tr key={m.id}>
                  <td>
                    <Checkbox
                      checked={isChecked}
                      onChange={() => toggleOne(m.id)}
                      style={{ margin: 0 }}
                    />
                  </td>
                  <td>{m.correlation_rule?.name ?? <span className="bp6-text-muted">—</span>}</td>
                  <td className="mono">
                    {m.signal
                      ? <><Icon icon={SIGNAL_ICON_NAME[m.signal.signal_type] ?? 'dot'} size={12} style={{ marginRight: 5 }} />{m.signal.signal_type.replace(/_/g, ' ')}</>
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
                              {a.replace(/_/g, ' ')}
                            </Tag>
                          ))
                        : <span className="bp6-text-muted">—</span>}
                    </div>
                  </td>
                  <td className="mono">{distKm != null ? `${Number(distKm).toFixed(1)} km` : '—'}</td>
                  <td className="mono">{fmt(m.fired_at)}</td>
                </tr>
                {txBtns.length > 0 && !bulkActive && (
                  <tr key={`${m.id}-tx`} style={{ background: 'transparent' }}>
                    <td colSpan={7} style={{ paddingTop: 2, paddingBottom: 6, border: 'none' }}>
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
              </>
            )
          })}
        </tbody>
      </HTMLTable>
    </div>
  )
}

function AssetsTab({ siteId }: { siteId: string }) {
  const { data, isPending, error } = useAssets({ home_site_id: siteId, per_page: 50 })

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (error) return <Callout intent="danger" compact>{error.message}</Callout>

  const assets = data?.data ?? []

  if (assets.length === 0) {
    return (
      <NonIdealState
        icon="box"
        title="No assets"
        description="No assets assigned to this site."
        className="tab-empty-state"
      />
    )
  }

  const STATUS_COLOR: Record<string, 'success' | 'warning' | 'danger' | 'none'> = {
    available: 'success', in_use: 'primary' as never, maintenance: 'warning', offline: 'danger',
  }

  return (
    <HTMLTable className="data-table" striped>
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {assets.map((a: Asset) => (
          <tr key={a.id}>
            <td>{a.name}</td>
            <td className="mono">{a.asset_type}</td>
            <td>
              <Tag minimal intent={STATUS_COLOR[a.status] ?? 'none'}>
                {a.status.replace('_', ' ')}
              </Tag>
            </td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}

// ── create task dialog ────────────────────────────────────────────────────────

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'low',      label: 'Low' },
  { value: 'normal',   label: 'Normal' },
  { value: 'high',     label: 'High' },
  { value: 'critical', label: 'Critical' },
]

function CreateTaskDialog({ siteId, isOpen, onClose }: { siteId: string; isOpen: boolean; onClose: () => void }) {
  const [title, setTitle]         = useState('')
  const [description, setDesc]    = useState('')
  const [priority, setPriority]   = useState<TaskPriority>('normal')
  const [error, setError]         = useState<string | null>(null)
  const { mutate, isPending }     = useCreateTask()

  function handleSubmit() {
    if (!title.trim()) { setError('Title is required'); return }
    setError(null)
    mutate(
      { site_id: siteId, title: title.trim(), description: description.trim() || undefined, priority },
      {
        onSuccess: () => { onClose(); setTitle(''); setDesc(''); setPriority('normal') },
        onError: (e: Error) => setError(e.message),
      }
    )
  }

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="New Task" style={{ width: 440 }}>
      <DialogBody>
        {error && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{error}</Callout>}
        <FormGroup label="Title" labelFor="ct-title" labelInfo="(required)">
          <InputGroup
            id="ct-title"
            placeholder="e.g. Investigate GPS jamming near sector 4"
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
          />
        </FormGroup>
        <FormGroup label="Description" labelFor="ct-desc">
          <TextArea
            id="ct-desc"
            fill
            rows={3}
            placeholder="Optional — additional context or instructions"
            value={description}
            onChange={e => setDesc(e.target.value)}
          />
        </FormGroup>
        <FormGroup label="Priority" labelFor="ct-priority">
          <HTMLSelect
            id="ct-priority"
            value={priority}
            onChange={e => setPriority(e.target.value as TaskPriority)}
            fill
          >
            {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </HTMLSelect>
        </FormGroup>
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button intent="primary" onClick={handleSubmit} loading={isPending}>Create Task</Button>
          </>
        }
      />
    </Dialog>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function SiteDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tab, setTab]             = useState<string>('tasks')
  const [createTaskOpen, setCreateTaskOpen] = useState(false)

  const { data: site, isPending, error } = useSite(id)
  const { data: readinessData } = useReadiness()
  const readiness = readinessData?.find((r) => r.site_id === id) ?? null
  const { mutate: unflag, isPending: unflagging }           = useUnflagSite()
  const { mutate: toggleStatus, isPending: togglingStatus } = useToggleSiteStatus()

  if (isPending) {
    return (
      <div className="page-content">
        <div className="page-header">
          <span className={Classes.SKELETON} style={{ width: 220, height: 24, display: 'inline-block' }} />
        </div>
        <Spinner size={24} />
      </div>
    )
  }

  if (error || !site) {
    return (
      <div className="page-content">
        <Callout intent="danger" title="Failed to load site">
          {error?.message ?? 'Site not found'}
        </Callout>
      </div>
    )
  }

  const readinessScore = readiness?.score ?? null
  const readinessIntent =
    readinessScore == null ? 'none'
    : readinessScore >= 0.8 ? 'success'
    : readinessScore >= 0.5 ? 'warning'
    : 'danger'

  return (
    <div className="page-content site-detail">
      <CreateTaskDialog
        siteId={site.id}
        isOpen={createTaskOpen}
        onClose={() => setCreateTaskOpen(false)}
      />

      {/* ── header ── */}
      <div className="site-detail-header">
        <Button
          icon="arrow-left"
          minimal
          small
          onClick={() => navigate('/sites')}
          style={{ marginRight: 4 }}
        />
        <h2 className="bp6-heading" style={{ margin: 0 }}>{site.name}</h2>

        <Tag minimal intent={site.status === 'active' ? 'success' : 'none'} style={{ marginLeft: 6 }}>
          {site.status}
        </Tag>

        {site.flagged_at && (
          <>
            <Tag minimal intent="danger" icon="flag" title={site.flag_reason ?? 'Flagged'}>
              flagged
            </Tag>
            <Button
              icon="flag"
              intent="danger"
              minimal
              small
              loading={unflagging}
              onClick={() => unflag(site.id)}
              title="Clear flag"
            >
              Clear flag
            </Button>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Button
            icon={site.status === 'active' ? 'pause' : 'play'}
            minimal
            small
            loading={togglingStatus}
            intent={site.status === 'active' ? 'none' : 'success'}
            onClick={() => toggleStatus(site.id)}
            title={site.status === 'active' ? 'Deactivate site' : 'Activate site'}
          >
            {site.status === 'active' ? 'Deactivate' : 'Activate'}
          </Button>
          {readinessScore != null && (
            <Tag minimal intent={readinessIntent}>
              Readiness {Math.round(readinessScore * 100)}%
            </Tag>
          )}
        </div>
      </div>

      {/* ── meta row ── */}
      <div className="site-detail-meta">
        <span className="bp6-text-muted mono">
          {Number(site.latitude).toFixed(4)}, {Number(site.longitude).toFixed(4)}
        </span>
        {site.flagged_at && site.flag_reason && (
          <Callout intent="danger" compact style={{ marginTop: 10 }}>
            <strong>Flag reason:</strong> {site.flag_reason}
          </Callout>
        )}
        {readiness && (
          <div className="site-readiness-row">
            <span className="bp6-text-muted" style={{ fontSize: 12 }}>
              {readiness.counts.resolved}/{readiness.counts.total} tasks resolved
              {readiness.counts.blocked > 0 && ` · ${readiness.counts.blocked} blocked`}
            </span>
          </div>
        )}
      </div>

      {/* ── risk trend chart ── */}
      <RiskScoreChart siteId={site.id} />

      {/* ── tabs ── */}
      <Tabs
        id="site-detail-tabs"
        selectedTabId={tab}
        onChange={(t) => setTab(String(t))}
        className="site-detail-tabs"
      >
        <Tab id="tasks" title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Tasks
            <Button
              icon="plus"
              minimal
              small
              intent="primary"
              onClick={e => { e.stopPropagation(); setCreateTaskOpen(true) }}
              title="New task for this site"
            />
          </span>
        } panel={<TasksTab siteId={site.id} />} />
        <Tab id="signals" title="Signals" panel={<SignalsTab siteId={site.id} />} />
        <Tab id="rule_fires" title="Rule Fires" panel={<RuleFiresTab siteId={site.id} />} />
        <Tab id="assets" title="Assets" panel={<AssetsTab siteId={site.id} />} />
        <Tab id="timeline" title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>Timeline</span>
            <span style={{
              fontSize: 9, background: '#e65100', color: '#fff',
              borderRadius: 3, padding: '1px 4px', fontWeight: 700, letterSpacing: '0.03em'
            }}>NEW</span>
          </span>
        } panel={<SiteTimeline siteId={site.id} />} />
        <Tab id="audit" title="Audit Trail" panel={
          <div style={{ paddingTop: 12 }}>
            <AuditTimeline entityType="Site" entityId={site.id} />
          </div>
        } />
      </Tabs>
    </div>
  )
}
