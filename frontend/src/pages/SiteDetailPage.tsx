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
  Drawer,
  DrawerSize,
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
import EntityCard from '../components/EntityCard'
import { useSite, useUnflagSite, useToggleSiteStatus, useUpdateSiteGeofence } from '../hooks/useSite'
import { useTasks, useCreateTask } from '../hooks/useTasks'
import { useSignals } from '../hooks/useSignals'
import { useSignalRuleMatches, useTransitionAlert, useBulkTransitionAlerts } from '../hooks/useSignalRuleMatches'
import { useAssets } from '../hooks/useAssets'
import { useReadiness } from '../hooks/useReadiness'
import { useSites } from '../hooks/useSites'
import { useRole } from '../hooks/useRole'
import { useReplay } from '../context/ReplayContext'
import AuditTimeline from '../components/AuditTimeline'
import SiteTimeline from '../components/SiteTimeline'
import AlertChainDrawer from '../components/AlertChainDrawer'
import RiskScoreChart from '../components/RiskScoreChart'
import { SIGNAL_ICON_NAME } from '../lib/signalIcons'
import type { TaskPriority, AlertStatus } from '../api/types'
import type { Task, Signal, SignalRuleMatch, Asset } from '../api/types'
import { humanize } from '../utils/humanize'

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

function TasksTab({ siteId, asOf, onSelect }: { siteId: string; asOf?: string | null; onSelect: (task: Task) => void }) {
  const { data, isPending, error } = useTasks({ site_id: siteId, per_page: 50, ...(asOf ? { as_of: asOf } : {}) })

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
    <HTMLTable className="data-table" striped interactive>
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
          <tr key={t.id} onClick={() => onSelect(t)} className="clickable-row">
            <td>{t.title}</td>
            <td>
              <Tag minimal intent={PRIORITY_INTENT[t.priority] ?? 'none'}>
                {t.priority}
              </Tag>
            </td>
            <td>
              <Tag minimal intent={STATUS_INTENT[t.workflow_status] ?? 'none'}>
                {humanize(t.workflow_status)}
              </Tag>
            </td>
            <td className="mono">{fmt(t.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}

function SignalsTab({ siteId, asOf }: { siteId: string; asOf?: string | null }) {
  const { data, isPending, error } = useSignals({ site_id: siteId, per_page: 50, ...(asOf ? { as_of: asOf } : {}) }, { refetchInterval: asOf ? false : 5000 })

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
              {humanize(s.signal_type)}
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

function RuleFiresTab({
  siteId,
  isReplaying,
  onChain,
}: {
  siteId: string
  isReplaying: boolean
  onChain: (m: SignalRuleMatch) => void
}) {
  const { data, isPending, error } = useSignalRuleMatches(
    { site_id: siteId, per_page: 50 },
    { enabled: !isReplaying, refetchInterval: isReplaying ? false : 10_000 },
  )
  const transition   = useTransitionAlert()
  const bulkTransition = useBulkTransitionAlerts()
  const [selected, setSelected] = useState<Set<string>>(new Set())

  if (isReplaying) {
    return (
      <NonIdealState
        icon="history"
        title="Rule fires unavailable in replay"
        description="Alert workflow state and geofence-breach triage are live-only and are hidden during replay."
        className="tab-empty-state"
      />
    )
  }

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
              <>
                <tr key={m.id}>
                  <td>
                    <Checkbox
                      checked={isChecked}
                      onChange={() => toggleOne(m.id)}
                      style={{ margin: 0 }}
                    />
                  </td>
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
                {txBtns.length > 0 && !bulkActive && (
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
              </>
            )
          })}
        </tbody>
      </HTMLTable>
    </div>
  )
}

function AssetsTab({ siteId, asOf, onSelect }: { siteId: string; asOf?: string | null; onSelect: (asset: Asset) => void }) {
  const { data, isPending, error } = useAssets({ home_site_id: siteId, per_page: 50, ...(asOf ? { as_of: asOf } : {}) })

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
    available: 'success', assigned: 'none', degraded: 'warning', offline: 'danger',
  }

  return (
    <HTMLTable className="data-table" striped interactive>
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {assets.map((a: Asset) => (
          <tr key={a.id} onClick={() => onSelect(a)} className="clickable-row">
            <td>{a.name}</td>
            <td className="mono">{a.asset_type}</td>
            <td>
              <Tag minimal intent={STATUS_COLOR[a.status] ?? 'none'}>
                {humanize(a.status)}
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
  const [assetId, setAssetId]     = useState<string>('')
  const [error, setError]         = useState<string | null>(null)
  const { mutate, isPending }     = useCreateTask()
  const { data: assetRes }        = useAssets({ per_page: 200 })
  const assets                    = assetRes?.data ?? []

  function handleSubmit() {
    if (!title.trim()) { setError('Title is required'); return }
    setError(null)
    mutate(
      {
        site_id:     siteId,
        title:       title.trim(),
        description: description.trim() || undefined,
        priority,
        asset_id:    assetId || undefined,
      },
      {
        onSuccess: () => { onClose(); setTitle(''); setDesc(''); setPriority('normal'); setAssetId('') },
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
        <FormGroup label="Assign Asset" labelFor="ct-asset">
          <HTMLSelect
            id="ct-asset"
            value={assetId}
            onChange={e => setAssetId(e.target.value)}
            fill
          >
            <option value="">— Unassigned —</option>
            {assets.map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.status})</option>
            ))}
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
  const { asOf, isReplaying } = useReplay()
  const [tab, setTab]             = useState<string>('tasks')
  const [createTaskOpen, setCreateTaskOpen] = useState(false)
  const [editingGeofence, setEditingGeofence] = useState(false)
  const [geofenceInput, setGeofenceInput]     = useState('')
  const [chainMatch, setChainMatch]           = useState<import('../api/types').SignalRuleMatch | null>(null)
  const [entityCard, setEntityCard]           = useState<{ type: 'task' | 'asset'; id: string; title: string } | null>(null)

  const { isCommander } = useRole()

  const { data: liveSite, isPending: liveSitePending, error: liveSiteError } = useSite(!isReplaying ? id : undefined)
  const replaySitesQuery = useSites({ per_page: 200, ...(asOf ? { as_of: asOf } : {}) }, isReplaying)
  const site = isReplaying
    ? (replaySitesQuery.data?.data.find((candidate) => candidate.id === id) ?? null)
    : (liveSite ?? null)
  const isPending = isReplaying ? replaySitesQuery.isPending : liveSitePending
  const error = isReplaying ? replaySitesQuery.error : liveSiteError
  const { data: readinessData } = useReadiness(asOf ? { as_of: asOf } : undefined)
  const readiness = readinessData?.find((r) => r.site_id === id) ?? null
  const { mutate: unflag, isPending: unflagging }           = useUnflagSite()
  const { mutate: toggleStatus, isPending: togglingStatus } = useToggleSiteStatus()
  const { mutate: updateGeofence, isPending: savingGeofence } = useUpdateSiteGeofence()

  // Active geofence breach count — use meta.total (the true server-side count)
  // rather than data.length so the badge is accurate even when total > per_page.
  const { data: breachMatchesRes } = useSignalRuleMatches(
    id ? { site_id: id, geofence_breach: true, workflow_status: 'unacknowledged', per_page: 50 } : undefined,
    { enabled: !isReplaying, refetchInterval: isReplaying ? false : 10_000 },
  )
  const activeBreachCount = isReplaying ? 0 : (breachMatchesRes?.meta?.total ?? 0)
  const visibleCreateTaskOpen = !isReplaying && createTaskOpen
  const visibleEditingGeofence = !isReplaying && editingGeofence
  const visibleChainMatch = !isReplaying ? chainMatch : null
  const selectedTab = isReplaying && tab === 'timeline' ? 'tasks' : tab

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
      {!isReplaying && (
        <CreateTaskDialog
          siteId={site.id}
          isOpen={visibleCreateTaskOpen}
          onClose={() => setCreateTaskOpen(false)}
        />
      )}
      {!isReplaying && (
        <AlertChainDrawer
          match={visibleChainMatch}
          onClose={() => setChainMatch(null)}
        />
      )}
      <Drawer
        isOpen={entityCard !== null}
        onClose={() => setEntityCard(null)}
        size={DrawerSize.SMALL}
        title={entityCard?.title ?? ''}
        className="bp6-dark"
      >
        {entityCard && (
          <div className="drawer-body">
            <EntityCard entityType={entityCard.type} entityId={entityCard.id} />
          </div>
        )}
      </Drawer>

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
            {isCommander && !isReplaying && (
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
            )}
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {isCommander && !isReplaying && (
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
          )}
          {readinessScore != null && (
            <Tag minimal intent={readinessIntent}>
              Readiness {Math.round(readinessScore * 100)}%
            </Tag>
          )}
        </div>
      </div>

      {isReplaying && (
        <Callout intent="warning" icon="history" compact style={{ marginBottom: 12 }}>
          Risk trends, geofence-breach workflow, rule-fire triage, audit trail, and site mutations are hidden during replay because those features are only available as live state.
        </Callout>
      )}

      {/* ── geofence breach callout ── */}
      {activeBreachCount > 0 && site.geofence_radius_km > 0 && (
        <Callout
          intent="warning"
          icon="locate"
          compact
          style={{ marginBottom: 8 }}
        >
          <strong>
            {activeBreachCount} active geofence breach{activeBreachCount !== 1 ? 'es' : ''}
          </strong>
          {' '}— {activeBreachCount} unacknowledged signal{activeBreachCount !== 1 ? 's' : ''} within the {site.geofence_radius_km} km perimeter.
          {' '}<span className="bp6-text-muted" style={{ fontSize: 11 }}>
            See the Rule Fires tab for details.
          </span>
        </Callout>
      )}

      {/* ── meta row ── */}
      <div className="site-detail-meta">
        <span className="bp6-text-muted mono">
          {Number(site.latitude).toFixed(4)}, {Number(site.longitude).toFixed(4)}
        </span>

        {/* Geofence radius */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
          <Icon icon="locate" size={12} style={{ opacity: 0.6 }} />
          {isCommander && visibleEditingGeofence ? (
            <>
              <InputGroup
                small
                value={geofenceInput}
                onChange={e => setGeofenceInput(e.target.value)}
                placeholder="km"
                style={{ width: 72 }}
                rightElement={<span style={{ padding: '4px 6px', fontSize: 11, opacity: 0.6 }}>km</span>}
              />
              <Button
                small
                intent="primary"
                loading={savingGeofence}
                onClick={() => {
                  const km = parseFloat(geofenceInput)
                  if (!isNaN(km) && km > 0) {
                    updateGeofence({ id: site.id, geofence_radius_km: km }, {
                      onSuccess: () => setEditingGeofence(false),
                    })
                  }
                }}
              >Save</Button>
              <Button small minimal onClick={() => setEditingGeofence(false)}>Cancel</Button>
            </>
          ) : (
            <>
              <span className="bp6-text-muted" style={{ fontSize: 12 }}>
                Geofence {site.geofence_radius_km} km
              </span>
              {isCommander && !isReplaying && (
                <Button
                  icon="edit"
                  minimal
                  small
                  style={{ minWidth: 0, minHeight: 0 }}
                  onClick={() => { setGeofenceInput(String(site.geofence_radius_km)); setEditingGeofence(true) }}
                  title="Edit geofence radius"
                />
              )}
            </>
          )}
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
      {!isReplaying && <RiskScoreChart siteId={site.id} />}

      {/* ── tabs ── */}
      <Tabs
        id="site-detail-tabs"
        selectedTabId={selectedTab}
        onChange={(t) => setTab(String(t))}
        className="site-detail-tabs"
      >
        <Tab id="tasks" title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Tasks
            {!isReplaying && <Button
              icon="plus"
              minimal
              small
              intent="primary"
              onClick={e => { e.stopPropagation(); setCreateTaskOpen(true) }}
              title="New task for this site"
            />}
          </span>
        } panel={<TasksTab siteId={site.id} asOf={asOf} onSelect={(t) => setEntityCard({ type: 'task', id: t.id, title: t.title })} />} />
        <Tab id="signals" title="Signals" panel={<SignalsTab siteId={site.id} asOf={asOf} />} />
        <Tab id="rule_fires" title="Rule Fires" panel={<RuleFiresTab siteId={site.id} isReplaying={isReplaying} onChain={setChainMatch} />} />
        <Tab id="assets" title="Assets" panel={<AssetsTab siteId={site.id} asOf={asOf} onSelect={(a) => setEntityCard({ type: 'asset', id: a.id, title: a.name })} />} />
        {!isReplaying && <Tab id="timeline" title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>Timeline</span>
            <span style={{
              fontSize: 9, background: '#e65100', color: '#fff',
              borderRadius: 3, padding: '1px 4px', fontWeight: 700, letterSpacing: '0.03em'
            }}>NEW</span>
          </span>
        } panel={<SiteTimeline siteId={site.id} />} />}
        <Tab id="audit" title="Audit Trail" panel={
          isReplaying ? (
            <NonIdealState
              icon="history"
              title="Audit trail unavailable in replay"
              description="Site audit events are currently live-only and are hidden during replay to avoid mixing present-time changes into a historical snapshot."
              className="tab-empty-state"
            />
          ) : (
            <div style={{ paddingTop: 12 }}>
              <AuditTimeline entityType="Site" entityId={site.id} />
            </div>
          )
        } />
      </Tabs>
    </div>
  )
}
