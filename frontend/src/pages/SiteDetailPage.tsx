import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Button,
  Callout,
  Classes,
  Drawer,
  DrawerSize,
  Icon,
  InputGroup,
  Spinner,
  Tab,
  Tabs,
  Tag,
} from '@blueprintjs/core'
import EntityCard from '../components/EntityCard'
import SiteTasksTab from '../components/site-detail/SiteTasksTab'
import SiteSignalsTab from '../components/site-detail/SiteSignalsTab'
import SiteRuleFiresTab from '../components/site-detail/SiteRuleFiresTab'
import SiteAssetsTab from '../components/site-detail/SiteAssetsTab'
import SiteCompareTab from '../components/site-detail/SiteCompareTab'
import CreateTaskDialog from '../components/site-detail/CreateTaskDialog'
import { useSite, useUnflagSite, useToggleSiteStatus, useUpdateSiteGeofence } from '../hooks/useSite'
import { useSignalRuleMatches } from '../hooks/useSignalRuleMatches'
import { useReadiness } from '../hooks/useReadiness'
import { useSites } from '../hooks/useSites'
import { useRole } from '../hooks/useRole'
import { useReplay } from '../context/ReplayContext'
import AuditTimeline from '../components/AuditTimeline'
import SiteTimeline from '../components/SiteTimeline'
import AlertChainDrawer from '../components/AlertChainDrawer'
import RiskScoreChart from '../components/RiskScoreChart'

function deriveEntityCardFromSearch(
  taskQueryParam: string | null,
  assetQueryParam: string | null,
): { type: 'task' | 'asset'; id: string; title: string } | null {
  if (taskQueryParam) return { type: 'task', id: taskQueryParam, title: 'Task' }
  if (assetQueryParam) return { type: 'asset', id: assetQueryParam, title: 'Asset' }
  return null
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function SiteDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { asOf, isReplaying } = useReplay()
  const taskQueryParam = searchParams.get('task')
  const assetQueryParam = searchParams.get('asset')
  const [tab, setTab]             = useState<string>('tasks')
  const [createTaskOpen, setCreateTaskOpen] = useState(false)
  const [editingGeofence, setEditingGeofence] = useState(false)
  const [geofenceInput, setGeofenceInput]     = useState('')
  const [chainMatch, setChainMatch]           = useState<import('../api/types').SignalRuleMatch | null>(null)
  const [entityCard, setEntityCard]           = useState<{ type: 'task' | 'asset'; id: string; title: string } | null>(() => {
    return deriveEntityCardFromSearch(taskQueryParam, assetQueryParam)
  })

  const { isCommander, isOperator } = useRole()
  const canOperate = isCommander || isOperator

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
    id ? { site_id: id, geofence_breach: true, workflow_status: 'unacknowledged', per_page: 50, ...(asOf ? { as_of: asOf } : {}) } : undefined,
    { enabled: Boolean(id), refetchInterval: isReplaying ? false : 10_000 },
  )
  const activeBreachCount = breachMatchesRes?.meta?.total ?? 0
  const visibleCreateTaskOpen = canOperate && !isReplaying && createTaskOpen
  const visibleEditingGeofence = !isReplaying && editingGeofence
  const visibleChainMatch = !isReplaying ? chainMatch : null
  const selectedTab = isReplaying && tab === 'timeline' ? 'tasks' : tab

  useEffect(() => {
    // Functional updater with equality guard prevents cascading renders; disable is intentional
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntityCard(current => {
      const next = deriveEntityCardFromSearch(taskQueryParam, assetQueryParam)
      if (!next) return null
      if (current?.type === next.type && current.id === next.id) return current
      return next
    })
  }, [assetQueryParam, taskQueryParam])

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
      {canOperate && !isReplaying && (
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
          Site mutations remain live-only. Historical risk trends, breaches, tasks, signals, rule fires, timeline events, and audit history are clipped to the replay timestamp.
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
      <RiskScoreChart siteId={site.id} asOf={asOf} />

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
            {canOperate && !isReplaying && <Button
              icon="plus"
              minimal
              small
              intent="primary"
              onClick={e => { e.stopPropagation(); setCreateTaskOpen(true) }}
              title="New task for this site"
            />}
          </span>
        } panel={<SiteTasksTab siteId={site.id} asOf={asOf} onSelect={(t) => setEntityCard({ type: 'task', id: t.id, title: t.title })} />} />
        <Tab id="signals" title="Signals" panel={<SiteSignalsTab siteId={site.id} asOf={asOf} />} />
        <Tab id="rule_fires" title="Rule Fires" panel={<SiteRuleFiresTab siteId={site.id} isReplaying={isReplaying} asOf={asOf} onChain={setChainMatch} />} />
        <Tab id="assets" title="Assets" panel={<SiteAssetsTab siteId={site.id} asOf={asOf} onSelect={(a) => setEntityCard({ type: 'asset', id: a.id, title: a.name })} />} />
        <Tab id="timeline" title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>Timeline</span>
            <span style={{
              fontSize: 9, background: '#e65100', color: '#fff',
              borderRadius: 3, padding: '1px 4px', fontWeight: 700, letterSpacing: '0.03em'
            }}>NEW</span>
          </span>
        } panel={<SiteTimeline siteId={site.id} asOf={asOf} />} />
        <Tab
          id="compare"
          title="Compare"
          disabled={isReplaying}
          panel={
            <SiteCompareTab
              siteId={site.id}
              openedAt={site.created_at}
              defaultLatestAt={site.updated_at}
            />
          }
        />
        <Tab id="audit" title="Audit Trail" panel={
          <div style={{ paddingTop: 12 }}>
            <AuditTimeline entityType="Site" entityId={site.id} asOf={asOf} />
          </div>
        } />
      </Tabs>
    </div>
  )
}
