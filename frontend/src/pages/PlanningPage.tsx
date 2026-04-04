import { useMemo, useState } from 'react'
import {
  Callout,
  Drawer,
  DrawerSize,
  NonIdealState,
  Spinner,
} from '@blueprintjs/core'
import { usePlanning } from '../hooks/usePlanning'
import { useSites } from '../hooks/useSites'
import { useUpdateTask } from '../hooks/useTasks'
import {
  useCreateCommanderIntent,
  useCreatePacePlan,
  useCreateSaluteReport,
  useUpdateCommanderIntent,
  useUpdatePacePlan,
} from '../hooks/usePlanningDoctrine'
import {
  useCreateChokepoint,
  useDeleteChokepoint,
  useUpdateChokepoint,
} from '../hooks/useChokepoints'
import { useRole } from '../hooks/useRole'
import { useNavigate } from 'react-router-dom'
import EntityCard from '../components/EntityCard'
import { PlanningAssetCoverageSection } from '../components/planning/PlanningAssetCoverageSection'
import { PlanningChokepointsSection } from '../components/planning/PlanningChokepointsSection'
import { PlanningDoctrineSection } from '../components/planning/PlanningDoctrineSection'
import { PlanningTasksSection } from '../components/planning/PlanningTasksSection'
import { useReplay } from '../context/ReplayContext'
import { computeFlags } from '../utils/planningFlags'
import { buildCoverageCircles, coverageBySite } from '../lib/coverage'
import { useTelemetry } from '../hooks/useTelemetry'
import { getApiErrorMessage } from '../api/client'
import { usePlanningDrafts } from '../hooks/usePlanningDrafts'
import { PRIORITY_ORDER } from '../lib/planningPageUtils'
import type { Site } from '../api/types'
import type { EntityType } from '../components/EntityCard'

export default function PlanningPage() {
  const { isCommander } = useRole()
  const { isReplaying, asOf } = useReplay()
  const navigate = useNavigate()
  const { data, isLoading, isError } = usePlanning(isCommander)
  const sitesQuery = useSites({ per_page: 200, ...(isReplaying && asOf ? { as_of: asOf } : {}) }, isCommander)
  const updateTask = useUpdateTask()
  const createCommanderIntent = useCreateCommanderIntent()
  const updateCommanderIntent = useUpdateCommanderIntent()
  const createPacePlan = useCreatePacePlan()
  const updatePacePlan = useUpdatePacePlan()
  const createSaluteReport = useCreateSaluteReport()
  const createChokepoint = useCreateChokepoint()
  const updateChokepoint = useUpdateChokepoint()
  const deleteChokepoint = useDeleteChokepoint()
  const { readings } = useTelemetry(isCommander, asOf)

  const [pendingAssets, setPendingAssets] = useState<Record<string, string | null | undefined>>({})
  const [entityCard, setEntityCard] = useState<{ type: EntityType; id: string } | null>(null)

  // Destructure data with safe defaults so hooks receive stable empty arrays
  const {
    tasks          = [],
    assets         = [],
    areas_of_operation = [],
    chokepoints = [],
    commander_intents = [],
    pace_plans = [],
    salute_reports = [],
    open_incidents = [],
    meta           = {
      truncated: false,
      task_count: 0,
      assets_truncated: false,
      asset_count: 0,
      areas_truncated: false,
      area_count: 0,
      chokepoints_truncated: false,
      chokepoint_count: 0,
      intents_truncated: false,
      intent_count: 0,
      pace_plans_truncated: false,
      pace_plan_count: 0,
      incidents_truncated: false,
      incident_count: 0,
      salute_reports_truncated: false,
      salute_report_count: 0,
      salute_report_meta_by_ao: {} as Record<string, { truncated: boolean; count: number }>,
    },
  } = data ?? {}
  const sites: Site[] = useMemo(() => sitesQuery.data?.data ?? [], [sitesQuery.data?.data])

  // ── Doctrine draft state (extracted hook) ──────────────────────────────────
  const drafts = usePlanningDrafts({
    areasOfOperation: areas_of_operation,
    chokepoints,
    commanderIntents: commander_intents,
    pacePlans: pace_plans,
    sites,
  })

  const doctrineSaluteReports = salute_reports.filter(report => report.area_of_operation_id === drafts.selectedDoctrineAoId)
  const doctrineSaluteMeta = drafts.selectedDoctrineAoId
    ? (meta.salute_report_meta_by_ao[drafts.selectedDoctrineAoId] ?? {
      truncated: false,
      count: doctrineSaluteReports.length,
    })
    : { truncated: false, count: 0 }

  // ── Derived values ─────────────────────────────────────────────────────────
  const flags = computeFlags(tasks, assets, open_incidents, areas_of_operation)

  const assetCounts = (() => {
    const counts = { available: 0, assigned: 0, degraded: 0, offline: 0, total: 0 }
    for (const a of assets) {
      counts.total++
      if (a.status in counts) counts[a.status as keyof typeof counts]++
    }
    return counts
  })()

  const aoCoverage = (() => {
    const byAo = new Map<string, { open: number; covered: number }>()
    for (const t of tasks) {
      if (!t.ao_id || t.workflow_status === 'resolved') continue
      const entry = byAo.get(t.ao_id) ?? { open: 0, covered: 0 }
      entry.open++
      if (t.asset_id) entry.covered++
      byAo.set(t.ao_id, entry)
    }
    return byAo
  })()

  const sortedTasks = [...tasks].sort((a, b) => {
    const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    if (pd !== 0) return pd
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })

  const assetTaskMap = (() => {
    const m = new Map<string, typeof tasks>()
    for (const t of tasks) {
      if (!t.asset_id || t.workflow_status === 'resolved') continue
      const list = m.get(t.asset_id) ?? []
      list.push(t)
      m.set(t.asset_id, list)
    }
    return m
  })()

  const allocatedAssets = assets.filter(a => assetTaskMap.has(a.id))

  const coverageCircles = buildCoverageCircles({ assets, tasks, sites, readings, allowHistoricalTelemetry: isReplaying })
  const siteCoverage = coverageBySite(sites, coverageCircles)
  const areasById = new Map(areas_of_operation.map(ao => [ao.id, ao]))

  const siteCoverageRows = sites
    .map(site => {
      const circles = siteCoverage.get(site.id) ?? []
      const openSiteTasks = tasks.filter(task => task.site_id === site.id && task.workflow_status !== 'resolved')
      const area = site.area_of_operation_id ? areasById.get(site.area_of_operation_id) ?? null : null
      const criticalGap = circles.length === 0 && openSiteTasks.some(task => task.priority === 'critical' || task.priority === 'high')
      return { site, area, circles, openTaskCount: openSiteTasks.length, criticalGap }
    })
    .sort((a, b) => Number(b.criticalGap) - Number(a.criticalGap) || a.site.name.localeCompare(b.site.name))

  // ── Early returns (after all hooks) ────────────────────────────────────────
  if (!isCommander) {
    return (
      <NonIdealState
        icon="lock"
        title="Commander access required"
        description="The Operational Planning Surface is only available to commanders."
      />
    )
  }

  if (isLoading || sitesQuery.isLoading) return <NonIdealState icon={<Spinner />} title="Loading planning data…" />
  if (isError || sitesQuery.isError || !data) return <NonIdealState icon="error" title="Failed to load planning data" />

  // ── Handlers ───────────────────────────────────────────────────────────────
  function handlePendingChange(taskId: string, assetId: string | null) {
    if (isReplaying) return
    setPendingAssets(prev => ({ ...prev, [taskId]: assetId }))
  }

  function handleConfirm(taskId: string, assetId: string | null) {
    if (isReplaying) return
    updateTask.mutate(
      { id: taskId, body: { asset_id: assetId } },
      { onSuccess: () => setPendingAssets(prev => { const n = { ...prev }; delete n[taskId]; return n }) },
    )
  }

  async function handleIntentSave() {
    if (isReplaying) return
    if (!drafts.selectedDoctrineAoId) return
    drafts.setIntentError(null)
    drafts.setIntentNotice(null)
    const body = {
      area_of_operation_id: drafts.selectedDoctrineAoId,
      title: drafts.intentDraft.title.trim(),
      objective: drafts.intentDraft.objective.trim(),
      end_state: drafts.intentDraft.end_state.trim(),
      constraints: drafts.intentDraft.constraints.trim() || null,
    }
    try {
      if (drafts.selectedCommanderIntent) {
        await updateCommanderIntent.mutateAsync({ id: drafts.selectedCommanderIntent.id, body })
      } else {
        await createCommanderIntent.mutateAsync(body)
      }
      drafts.setIntentNotice('Commander intent saved.')
    } catch (error) {
      drafts.setIntentError(getApiErrorMessage(error, 'Failed to save commander intent'))
    }
  }

  async function handlePaceSave() {
    if (isReplaying) return
    if (!drafts.selectedDoctrineAoId) return
    drafts.setPaceError(null)
    drafts.setPaceNotice(null)
    const body = {
      area_of_operation_id: drafts.selectedDoctrineAoId,
      primary_plan: drafts.paceDraft.primary_plan.trim(),
      alternate_plan: drafts.paceDraft.alternate_plan.trim(),
      contingency_plan: drafts.paceDraft.contingency_plan.trim(),
      emergency_plan: drafts.paceDraft.emergency_plan.trim(),
      notes: drafts.paceDraft.notes.trim() || null,
    }
    try {
      if (drafts.selectedPacePlan) {
        await updatePacePlan.mutateAsync({ id: drafts.selectedPacePlan.id, body })
      } else {
        await createPacePlan.mutateAsync(body)
      }
      drafts.setPaceNotice('PACE plan saved.')
    } catch (error) {
      drafts.setPaceError(getApiErrorMessage(error, 'Failed to save PACE plan'))
    }
  }

  async function handleSaluteSubmit() {
    if (isReplaying) return
    if (!drafts.selectedDoctrineAoId) return
    drafts.setSaluteError(null)
    drafts.setSaluteNotice(null)
    try {
      await createSaluteReport.mutateAsync({
        area_of_operation_id: drafts.selectedDoctrineAoId,
        site_id: drafts.saluteDraft.site_id || null,
        size: drafts.saluteDraft.size.trim() || null,
        activity: drafts.saluteDraft.activity.trim(),
        location: drafts.saluteDraft.location.trim(),
        unit: drafts.saluteDraft.unit.trim() || null,
        observed_at: new Date(drafts.saluteDraft.observed_at).toISOString(),
        equipment: drafts.saluteDraft.equipment.trim() || null,
        remarks: drafts.saluteDraft.remarks.trim() || null,
      })
      drafts.setSaluteNotice('SALUTE report submitted.')
      drafts.resetSaluteDraft()
    } catch (error) {
      drafts.setSaluteError(getApiErrorMessage(error, 'Failed to submit SALUTE report'))
    }
  }

  async function handleChokepointSave() {
    if (isReplaying) return
    if (!drafts.selectedDoctrineAoId) return
    drafts.setChokepointError(null)
    drafts.setChokepointNotice(null)
    const latitude = Number(drafts.chokepointDraft.latitude)
    const longitude = Number(drafts.chokepointDraft.longitude)
    const watchRadius = Number(drafts.chokepointDraft.watch_radius_km)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(watchRadius)) {
      drafts.setChokepointError('Latitude, longitude, and watch radius must be valid numbers.')
      return
    }
    const body = {
      area_of_operation_id: drafts.selectedDoctrineAoId,
      name: drafts.chokepointDraft.name.trim(),
      category: drafts.chokepointDraft.category,
      status: drafts.chokepointDraft.status,
      latitude,
      longitude,
      watch_radius_km: watchRadius,
      notes: drafts.chokepointDraft.notes.trim() || null,
    }
    try {
      const saved = drafts.selectedChokepoint
        ? await updateChokepoint.mutateAsync({ id: drafts.selectedChokepoint.id, body })
        : await createChokepoint.mutateAsync(body)
      drafts.setPendingSelectedChokepoint(saved)
      drafts.setSelectedChokepointId(saved.id)
      drafts.setChokepointNotice(drafts.selectedChokepoint ? 'Chokepoint updated.' : 'Chokepoint created.')
    } catch (error) {
      drafts.setChokepointError(getApiErrorMessage(error, 'Failed to save chokepoint'))
    }
  }

  async function handleChokepointDelete() {
    if (isReplaying) return
    if (!drafts.selectedChokepoint) return
    if (!window.confirm(`Delete chokepoint "${drafts.selectedChokepoint.name}"?`)) return
    drafts.setChokepointError(null)
    drafts.setChokepointNotice(null)
    try {
      await deleteChokepoint.mutateAsync(drafts.selectedChokepoint.id)
      drafts.setPendingSelectedChokepoint(null)
      drafts.setSelectedChokepointId('')
      drafts.setChokepointNotice('Chokepoint deleted.')
    } catch (error) {
      drafts.setChokepointError(getApiErrorMessage(error, 'Failed to delete chokepoint'))
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '20px 24px', maxWidth: 1400 }}>
      {isReplaying && (
        <Callout intent="primary" icon="info-sign" style={{ marginBottom: 16 }}>
          Viewing planning state as it existed at the replay timestamp. Doctrine, coverage, task allocation, and open-incident data are clipped to the selected historical cutoff. Write actions are disabled during replay.
        </Callout>
      )}
      <div style={{ marginBottom: 24 }}>
        <h2 className="bp6-heading" style={{ margin: 0 }}>Operational Planning Surface</h2>
        <span className="bp6-text-muted" style={{ fontSize: 13 }}>
          Cross-site task coverage · asset allocation · ROE posture
        </span>
      </div>

      <PlanningDoctrineSection
        areasOfOperation={areas_of_operation}
        selectedDoctrineAoId={drafts.selectedDoctrineAoId}
        selectedDoctrineAo={drafts.selectedDoctrineAo}
        selectedCommanderIntent={drafts.selectedCommanderIntent}
        selectedPacePlan={drafts.selectedPacePlan}
        doctrineSites={drafts.doctrineSites}
        doctrineSaluteReports={doctrineSaluteReports}
        doctrineSaluteMeta={doctrineSaluteMeta}
        intentDraft={drafts.intentDraft}
        paceDraft={drafts.paceDraft}
        saluteDraft={drafts.saluteDraft}
        setIntentDraft={drafts.setIntentDraft}
        setPaceDraft={drafts.setPaceDraft}
        setSaluteDraft={drafts.setSaluteDraft}
        onDoctrineAoChange={drafts.handleDoctrineAoChange}
        onIntentSave={handleIntentSave}
        onPaceSave={handlePaceSave}
        onSaluteSubmit={handleSaluteSubmit}
        isReplaying={isReplaying}
        intentError={drafts.intentError}
        paceError={drafts.paceError}
        saluteError={drafts.saluteError}
        intentNotice={drafts.intentNotice}
        paceNotice={drafts.paceNotice}
        saluteNotice={drafts.saluteNotice}
        intentSaving={createCommanderIntent.isPending || updateCommanderIntent.isPending}
        paceSaving={createPacePlan.isPending || updatePacePlan.isPending}
        saluteSaving={createSaluteReport.isPending}
      />

      <PlanningChokepointsSection
        areasOfOperation={areas_of_operation}
        selectedDoctrineAoId={drafts.selectedDoctrineAoId}
        selectedDoctrineAo={drafts.selectedDoctrineAo}
        selectedChokepointId={drafts.selectedChokepointId}
        selectedChokepoint={drafts.selectedChokepoint}
        doctrineChokepoints={drafts.doctrineChokepoints}
        pendingSelectedChokepoint={drafts.pendingSelectedChokepoint}
        chokepointDraft={drafts.chokepointDraft}
        setChokepointDraft={drafts.setChokepointDraft}
        setSelectedChokepointId={drafts.setSelectedChokepointId}
        setPendingSelectedChokepoint={drafts.setPendingSelectedChokepoint}
        onDoctrineAoChange={drafts.handleDoctrineAoChange}
        onSave={handleChokepointSave}
        onDelete={handleChokepointDelete}
        isReplaying={isReplaying}
        saving={createChokepoint.isPending || updateChokepoint.isPending}
        deleting={deleteChokepoint.isPending}
        error={drafts.chokepointError}
        notice={drafts.chokepointNotice}
      />

      {/* ── Overcommitment callouts ───────────────────────────────────────── */}
      {flags.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {flags.map((flag, i) => (
            <Callout
              key={i}
              intent={flag.type === 'critical_unassigned' ? 'warning' : 'danger'}
              icon={flag.type === 'double_assigned' ? 'duplicate' : flag.type === 'weapons_free_no_assets' ? 'shield' : 'person'}
              style={{ marginBottom: 8 }}
              compact
            >
              {flag.label}
              {flag.incidentId && (
                <span
                  style={{ marginLeft: 12, cursor: 'pointer', textDecoration: 'underline', fontSize: 12 }}
                  onClick={() => navigate(`/incidents/${flag.incidentId}`)}
                >
                  View incident →
                </span>
              )}
            </Callout>
          ))}
        </div>
      )}

      {meta.truncated && (
        <Callout intent="warning" icon="warning-sign" compact style={{ marginBottom: 16 }}>
          Showing first 500 tasks — some tasks may not be visible.
        </Callout>
      )}

      {meta.incidents_truncated && (
        <Callout intent="warning" icon="warning-sign" compact style={{ marginBottom: 16 }}>
          Showing first 200 open incidents — overcommitment warnings may be incomplete.
        </Callout>
      )}

      <PlanningAssetCoverageSection
        assetCounts={assetCounts}
        allocatedAssets={allocatedAssets}
        assetTaskMap={assetTaskMap}
        areasOfOperation={areas_of_operation}
        aoCoverage={aoCoverage}
        siteCoverageRows={siteCoverageRows}
        onOpenAsset={assetId => setEntityCard({ type: 'asset', id: assetId })}
      />

      {/* ── Entity card drawer ───────────────────────────────────────────── */}
      <Drawer
        isOpen={entityCard !== null}
        onClose={() => setEntityCard(null)}
        size={DrawerSize.SMALL}
        title={entityCard?.type === 'task' ? 'Task Detail' : 'Asset Detail'}
        hasBackdrop={false}
      >
        {entityCard && (
          <div style={{ padding: 16 }}>
            <EntityCard entityType={entityCard.type} entityId={entityCard.id} />
          </div>
        )}
      </Drawer>

      <PlanningTasksSection
        tasks={sortedTasks}
        assets={assets}
        pendingAssets={pendingAssets}
        updateTaskPending={updateTask.isPending}
        updateTaskId={updateTask.variables?.id}
        isReplaying={isReplaying}
        onOpenTask={taskId => setEntityCard({ type: 'task', id: taskId })}
        onPendingChange={handlePendingChange}
        onConfirm={handleConfirm}
      />
    </div>
  )
}
