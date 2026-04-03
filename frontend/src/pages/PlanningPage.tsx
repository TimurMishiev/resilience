import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Callout,
  Drawer,
  DrawerSize,
  HTMLTable,
  NonIdealState,
  Spinner,
  Tag,
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
import { PostureBadge } from '../components/PostureBadge'
import { AssetPicker } from '../components/AssetPicker'
import EntityCard from '../components/EntityCard'
import { PlanningChokepointsSection } from '../components/planning/PlanningChokepointsSection'
import { PlanningDoctrineSection } from '../components/planning/PlanningDoctrineSection'
import { useReplay } from '../context/ReplayContext'
import { humanize } from '../utils/humanize'
import { computeFlags } from '../utils/planningFlags'
import { buildCoverageCircles, coverageBySite } from '../lib/coverage'
import { useTelemetry } from '../hooks/useTelemetry'
import { getApiErrorMessage } from '../api/client'
import {
  makeDefaultObservedAt,
  PRIORITY_INTENT,
  PRIORITY_ORDER,
  sameChokepointDraft,
  sameIntentDraft,
  samePaceDraft,
  sameSaluteDraft,
  type ChokepointDraft,
  type IntentDraft,
  type PaceDraft,
  type SaluteDraft,
} from '../lib/planningPageUtils'
import type { Chokepoint, Posture } from '../api/types'
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

  // Per-row pending asset selection — keyed by task id
  const [pendingAssets, setPendingAssets] = useState<Record<string, string | null | undefined>>({})
  const [entityCard, setEntityCard] = useState<{ type: EntityType; id: string } | null>(null)
  const [selectedDoctrineAoId, setSelectedDoctrineAoId] = useState<string>('')
  const [intentDraft, setIntentDraft] = useState<IntentDraft>({
    title: '',
    objective: '',
    end_state: '',
    constraints: '',
  })
  const [paceDraft, setPaceDraft] = useState<PaceDraft>({
    primary_plan: '',
    alternate_plan: '',
    contingency_plan: '',
    emergency_plan: '',
    notes: '',
  })
  const [saluteDraft, setSaluteDraft] = useState<SaluteDraft>({
    site_id: '',
    size: '',
    activity: '',
    location: '',
    unit: '',
    observed_at: '',
    equipment: '',
    remarks: '',
  })
  const [selectedChokepointId, setSelectedChokepointId] = useState<string>('')
  const [pendingSelectedChokepoint, setPendingSelectedChokepoint] = useState<Chokepoint | null>(null)
  const [chokepointDraft, setChokepointDraft] = useState<ChokepointDraft>({
    name: '',
    category: 'strait',
    status: 'monitor',
    latitude: '',
    longitude: '',
    watch_radius_km: '25',
    notes: '',
  })
  const [intentError, setIntentError] = useState<string | null>(null)
  const [paceError, setPaceError] = useState<string | null>(null)
  const [saluteError, setSaluteError] = useState<string | null>(null)
  const [chokepointError, setChokepointError] = useState<string | null>(null)
  const [intentNotice, setIntentNotice] = useState<string | null>(null)
  const [paceNotice, setPaceNotice] = useState<string | null>(null)
  const [saluteNotice, setSaluteNotice] = useState<string | null>(null)
  const [chokepointNotice, setChokepointNotice] = useState<string | null>(null)

  // All hooks must come before any conditional returns (Rules of Hooks).
  // Destructure with defaults so hooks receive stable empty arrays when data is not yet loaded.
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
  const sites = useMemo(() => sitesQuery.data?.data ?? [], [sitesQuery.data?.data])

  const commanderIntentsByAo = useMemo(
    () => new Map(commander_intents.map(intent => [intent.area_of_operation_id, intent])),
    [commander_intents],
  )
  const pacePlansByAo = useMemo(
    () => new Map(pace_plans.map(plan => [plan.area_of_operation_id, plan])),
    [pace_plans],
  )
  const aoIdsKey = areas_of_operation.map(ao => ao.id).join('|')
  // aoIdsKey is a stable string identity proxy for areas_of_operation; intentional missing dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const doctrineAoIds = useMemo(() => areas_of_operation.map(ao => ao.id), [aoIdsKey])
  const firstDoctrineAoId = areas_of_operation[0]?.id ?? ''

  useEffect(() => {
    setSelectedDoctrineAoId(current => (
      firstDoctrineAoId.length === 0
        ? ''
        : current && doctrineAoIds.includes(current)
        ? current
        : firstDoctrineAoId
    ))
  }, [aoIdsKey, doctrineAoIds, firstDoctrineAoId])

  const selectedDoctrineAo = useMemo(
    () => areas_of_operation.find(ao => ao.id === selectedDoctrineAoId) ?? null,
    [areas_of_operation, selectedDoctrineAoId],
  )
  const selectedCommanderIntent = useMemo(
    () => (selectedDoctrineAoId ? (commanderIntentsByAo.get(selectedDoctrineAoId) ?? null) : null),
    [commanderIntentsByAo, selectedDoctrineAoId],
  )
  const selectedPacePlan = useMemo(
    () => (selectedDoctrineAoId ? (pacePlansByAo.get(selectedDoctrineAoId) ?? null) : null),
    [pacePlansByAo, selectedDoctrineAoId],
  )

  const doctrineSites = useMemo(
    () => sites.filter(site => site.area_of_operation_id === selectedDoctrineAoId),
    [sites, selectedDoctrineAoId],
  )
  const doctrineChokepoints = useMemo(
    () => chokepoints.filter(point => point.area_of_operation_id === selectedDoctrineAoId),
    [chokepoints, selectedDoctrineAoId],
  )
  const doctrineSaluteReports = useMemo(
    () => salute_reports.filter(report => report.area_of_operation_id === selectedDoctrineAoId),
    [salute_reports, selectedDoctrineAoId],
  )
  const doctrineSaluteMeta = selectedDoctrineAoId
    ? (meta.salute_report_meta_by_ao[selectedDoctrineAoId] ?? {
      truncated: false,
      count: doctrineSaluteReports.length,
    })
    : { truncated: false, count: 0 }
  const doctrineSiteIdsKey = doctrineSites.map(site => site.id).join('|')
  const firstDoctrineSiteId = doctrineSites[0]?.id ?? ''
  const firstDoctrineSite = doctrineSites[0] ?? null
  const doctrineChokepointIdsKey = doctrineChokepoints.map(point => point.id).join('|')
  const selectedChokepoint = useMemo(() => {
    const persisted = doctrineChokepoints.find(point => point.id === selectedChokepointId)
    if (persisted) return persisted
    if (
      pendingSelectedChokepoint &&
      pendingSelectedChokepoint.id === selectedChokepointId &&
      pendingSelectedChokepoint.area_of_operation_id === selectedDoctrineAoId
    ) {
      return pendingSelectedChokepoint
    }
    return null
  }, [doctrineChokepoints, pendingSelectedChokepoint, selectedChokepointId, selectedDoctrineAoId])
  const nextIntentDraft = useMemo(() => ({
    title: selectedCommanderIntent?.title ?? '',
    objective: selectedCommanderIntent?.objective ?? '',
    end_state: selectedCommanderIntent?.end_state ?? '',
    constraints: selectedCommanderIntent?.constraints ?? '',
  // id/updated_at + selectedDoctrineAoId are AO-switch and identity guards; not read in body.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    selectedDoctrineAoId,
    selectedCommanderIntent?.id,
    selectedCommanderIntent?.updated_at,
    selectedCommanderIntent?.title,
    selectedCommanderIntent?.objective,
    selectedCommanderIntent?.end_state,
    selectedCommanderIntent?.constraints,
  ])
  const nextPaceDraft = useMemo(() => ({
    primary_plan: selectedPacePlan?.primary_plan ?? '',
    alternate_plan: selectedPacePlan?.alternate_plan ?? '',
    contingency_plan: selectedPacePlan?.contingency_plan ?? '',
    emergency_plan: selectedPacePlan?.emergency_plan ?? '',
    notes: selectedPacePlan?.notes ?? '',
  // id/updated_at + selectedDoctrineAoId are AO-switch and identity guards; not read in body.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    selectedDoctrineAoId,
    selectedPacePlan?.id,
    selectedPacePlan?.updated_at,
    selectedPacePlan?.primary_plan,
    selectedPacePlan?.alternate_plan,
    selectedPacePlan?.contingency_plan,
    selectedPacePlan?.emergency_plan,
    selectedPacePlan?.notes,
  ])
  const nextSaluteDraft = useMemo(() => ({
    site_id: firstDoctrineSiteId,
    size: '',
    activity: '',
    location: '',
    unit: '',
    observed_at: makeDefaultObservedAt(),
    equipment: '',
    remarks: '',
  // doctrineSiteIdsKey + selectedDoctrineAoId are AO-switch and site-list guards; not read in body.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [selectedDoctrineAoId, doctrineSiteIdsKey, firstDoctrineSiteId])
  const nextChokepointDraft = useMemo(() => ({
    name: selectedChokepoint?.name ?? '',
    category: selectedChokepoint?.category ?? 'strait',
    status: selectedChokepoint?.status ?? 'monitor',
    latitude: selectedChokepoint ? String(selectedChokepoint.latitude) : (firstDoctrineSite ? String(Number(firstDoctrineSite.latitude)) : ''),
    longitude: selectedChokepoint ? String(selectedChokepoint.longitude) : (firstDoctrineSite ? String(Number(firstDoctrineSite.longitude)) : ''),
    watch_radius_km: selectedChokepoint ? String(selectedChokepoint.watch_radius_km) : '25',
    notes: selectedChokepoint?.notes ?? '',
  // Individual property deps avoid reference-equality churn; eslint missing-dep warning is intentional
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    selectedDoctrineAoId,
    selectedChokepoint?.id,
    selectedChokepoint?.updated_at,
    selectedChokepoint?.name,
    selectedChokepoint?.category,
    selectedChokepoint?.status,
    selectedChokepoint?.latitude,
    selectedChokepoint?.longitude,
    selectedChokepoint?.watch_radius_km,
    selectedChokepoint?.notes,
    firstDoctrineSite?.id,
    firstDoctrineSite?.latitude,
    firstDoctrineSite?.longitude,
  ])

  useEffect(() => {
    setIntentDraft(current => (sameIntentDraft(current, nextIntentDraft) ? current : nextIntentDraft))
    setIntentError(null)
  }, [nextIntentDraft])

  useEffect(() => {
    setPaceDraft(current => (samePaceDraft(current, nextPaceDraft) ? current : nextPaceDraft))
    setPaceError(null)
  }, [nextPaceDraft])

  useEffect(() => {
    setSaluteDraft(current => (sameSaluteDraft(current, nextSaluteDraft) ? current : nextSaluteDraft))
    setSaluteError(null)
  }, [nextSaluteDraft])

  useEffect(() => {
    setSelectedChokepointId(current => (
      current && doctrineChokepoints.some(point => point.id === current)
        ? current
        : current &&
            pendingSelectedChokepoint &&
            pendingSelectedChokepoint.id === current &&
            pendingSelectedChokepoint.area_of_operation_id === selectedDoctrineAoId
        ? current
        : ''
    ))
  }, [selectedDoctrineAoId, doctrineChokepointIdsKey, doctrineChokepoints, pendingSelectedChokepoint])

  useEffect(() => {
    if (!pendingSelectedChokepoint) return
    if (pendingSelectedChokepoint.area_of_operation_id !== selectedDoctrineAoId) {
      setPendingSelectedChokepoint(null)
      return
    }
    if (doctrineChokepoints.some(point => point.id === pendingSelectedChokepoint.id)) {
      setPendingSelectedChokepoint(null)
    }
  }, [doctrineChokepoints, pendingSelectedChokepoint, selectedDoctrineAoId])

  useEffect(() => {
    setChokepointDraft(current => (sameChokepointDraft(current, nextChokepointDraft) ? current : nextChokepointDraft))
    setChokepointError(null)
  }, [nextChokepointDraft])

  // ── Derived values (dataset is small; no memoization needed) ────────────

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

  // Per-asset allocation map: asset id → open tasks assigned to it
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

  // Only assets that currently have at least one open task, sorted by name
  const allocatedAssets = assets.filter(a => assetTaskMap.has(a.id))

  const coverageCircles = buildCoverageCircles({ assets, tasks, sites, readings, allowHistoricalTelemetry: isReplaying })
  const siteCoverage = coverageBySite(sites, coverageCircles)
  const areasById = new Map(areas_of_operation.map(ao => [ao.id, ao]))

  const siteCoverageRows = sites
    .map(site => {
      const circles = siteCoverage.get(site.id) ?? []
      const openSiteTasks = tasks.filter(task => task.site_id === site.id && task.workflow_status !== 'resolved')
      const area = site.area_of_operation_id ? areasById.get(site.area_of_operation_id) : null
      const criticalGap = circles.length === 0 && openSiteTasks.some(task => task.priority === 'critical' || task.priority === 'high')
      return {
        site,
        area,
        circles,
        openTaskCount: openSiteTasks.length,
        criticalGap,
      }
    })
    .sort((a, b) => Number(b.criticalGap) - Number(a.criticalGap) || a.site.name.localeCompare(b.site.name))

  // ── Early returns (after all hooks) ─────────────────────────────────────
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

  function handlePendingChange(taskId: string, assetId: string | null) {
    setPendingAssets(prev => ({ ...prev, [taskId]: assetId }))
  }

  function handleDoctrineAoChange(areaOfOperationId: string) {
    setSelectedDoctrineAoId(areaOfOperationId)
    setPendingSelectedChokepoint(null)
    setIntentNotice(null)
    setPaceNotice(null)
    setSaluteNotice(null)
    setChokepointNotice(null)
  }

  function handleConfirm(taskId: string, assetId: string | null) {
    updateTask.mutate(
      { id: taskId, body: { asset_id: assetId } },
      { onSuccess: () => setPendingAssets(prev => { const n = { ...prev }; delete n[taskId]; return n }) }
    )
  }

  async function handleIntentSave() {
    if (!selectedDoctrineAoId) return

    setIntentError(null)
    setIntentNotice(null)

    const body = {
      area_of_operation_id: selectedDoctrineAoId,
      title: intentDraft.title.trim(),
      objective: intentDraft.objective.trim(),
      end_state: intentDraft.end_state.trim(),
      constraints: intentDraft.constraints.trim() || null,
    }

    try {
      if (selectedCommanderIntent) {
        await updateCommanderIntent.mutateAsync({ id: selectedCommanderIntent.id, body })
      } else {
        await createCommanderIntent.mutateAsync(body)
      }
      setIntentNotice('Commander intent saved.')
    } catch (error) {
      setIntentError(getApiErrorMessage(error, 'Failed to save commander intent'))
    }
  }

  async function handlePaceSave() {
    if (!selectedDoctrineAoId) return

    setPaceError(null)
    setPaceNotice(null)

    const body = {
      area_of_operation_id: selectedDoctrineAoId,
      primary_plan: paceDraft.primary_plan.trim(),
      alternate_plan: paceDraft.alternate_plan.trim(),
      contingency_plan: paceDraft.contingency_plan.trim(),
      emergency_plan: paceDraft.emergency_plan.trim(),
      notes: paceDraft.notes.trim() || null,
    }

    try {
      if (selectedPacePlan) {
        await updatePacePlan.mutateAsync({ id: selectedPacePlan.id, body })
      } else {
        await createPacePlan.mutateAsync(body)
      }
      setPaceNotice('PACE plan saved.')
    } catch (error) {
      setPaceError(getApiErrorMessage(error, 'Failed to save PACE plan'))
    }
  }

  async function handleSaluteSubmit() {
    if (!selectedDoctrineAoId) return

    setSaluteError(null)
    setSaluteNotice(null)

    try {
      await createSaluteReport.mutateAsync({
        area_of_operation_id: selectedDoctrineAoId,
        site_id: saluteDraft.site_id || null,
        size: saluteDraft.size.trim() || null,
        activity: saluteDraft.activity.trim(),
        location: saluteDraft.location.trim(),
        unit: saluteDraft.unit.trim() || null,
        observed_at: new Date(saluteDraft.observed_at).toISOString(),
        equipment: saluteDraft.equipment.trim() || null,
        remarks: saluteDraft.remarks.trim() || null,
      })
      setSaluteNotice('SALUTE report submitted.')
      setSaluteDraft({
        site_id: firstDoctrineSiteId,
        size: '',
        activity: '',
        location: '',
        unit: '',
        observed_at: makeDefaultObservedAt(),
        equipment: '',
        remarks: '',
      })
    } catch (error) {
      setSaluteError(getApiErrorMessage(error, 'Failed to submit SALUTE report'))
    }
  }

  async function handleChokepointSave() {
    if (!selectedDoctrineAoId) return

    setChokepointError(null)
    setChokepointNotice(null)

    const latitude = Number(chokepointDraft.latitude)
    const longitude = Number(chokepointDraft.longitude)
    const watchRadius = Number(chokepointDraft.watch_radius_km)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(watchRadius)) {
      setChokepointError('Latitude, longitude, and watch radius must be valid numbers.')
      return
    }

    const body = {
      area_of_operation_id: selectedDoctrineAoId,
      name: chokepointDraft.name.trim(),
      category: chokepointDraft.category,
      status: chokepointDraft.status,
      latitude,
      longitude,
      watch_radius_km: watchRadius,
      notes: chokepointDraft.notes.trim() || null,
    }

    try {
      const saved = selectedChokepoint
        ? await updateChokepoint.mutateAsync({ id: selectedChokepoint.id, body })
        : await createChokepoint.mutateAsync(body)
      setPendingSelectedChokepoint(saved)
      setSelectedChokepointId(saved.id)
      setChokepointNotice(selectedChokepoint ? 'Chokepoint updated.' : 'Chokepoint created.')
    } catch (error) {
      setChokepointError(getApiErrorMessage(error, 'Failed to save chokepoint'))
    }
  }

  async function handleChokepointDelete() {
    if (!selectedChokepoint) return
    if (!window.confirm(`Delete chokepoint "${selectedChokepoint.name}"?`)) return

    setChokepointError(null)
    setChokepointNotice(null)

    try {
      await deleteChokepoint.mutateAsync(selectedChokepoint.id)
      setPendingSelectedChokepoint(null)
      setSelectedChokepointId('')
      setChokepointNotice('Chokepoint deleted.')
    } catch (error) {
      setChokepointError(getApiErrorMessage(error, 'Failed to delete chokepoint'))
    }
  }

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
        selectedDoctrineAoId={selectedDoctrineAoId}
        selectedDoctrineAo={selectedDoctrineAo}
        selectedCommanderIntent={selectedCommanderIntent}
        selectedPacePlan={selectedPacePlan}
        doctrineSites={doctrineSites}
        doctrineSaluteReports={doctrineSaluteReports}
        doctrineSaluteMeta={doctrineSaluteMeta}
        intentDraft={intentDraft}
        paceDraft={paceDraft}
        saluteDraft={saluteDraft}
        setIntentDraft={setIntentDraft}
        setPaceDraft={setPaceDraft}
        setSaluteDraft={setSaluteDraft}
        onDoctrineAoChange={handleDoctrineAoChange}
        onIntentSave={handleIntentSave}
        onPaceSave={handlePaceSave}
        onSaluteSubmit={handleSaluteSubmit}
        isReplaying={isReplaying}
        intentError={intentError}
        paceError={paceError}
        saluteError={saluteError}
        intentNotice={intentNotice}
        paceNotice={paceNotice}
        saluteNotice={saluteNotice}
        intentSaving={createCommanderIntent.isPending || updateCommanderIntent.isPending}
        paceSaving={createPacePlan.isPending || updatePacePlan.isPending}
        saluteSaving={createSaluteReport.isPending}
      />

      <PlanningChokepointsSection
        areasOfOperation={areas_of_operation}
        selectedDoctrineAoId={selectedDoctrineAoId}
        selectedDoctrineAo={selectedDoctrineAo}
        selectedChokepointId={selectedChokepointId}
        selectedChokepoint={selectedChokepoint}
        doctrineChokepoints={doctrineChokepoints}
        pendingSelectedChokepoint={pendingSelectedChokepoint}
        firstDoctrineSite={firstDoctrineSite}
        chokepointDraft={chokepointDraft}
        setChokepointDraft={setChokepointDraft}
        setSelectedChokepointId={setSelectedChokepointId}
        setPendingSelectedChokepoint={setPendingSelectedChokepoint}
        onDoctrineAoChange={handleDoctrineAoChange}
        onSave={handleChokepointSave}
        onDelete={handleChokepointDelete}
        isReplaying={isReplaying}
        saving={createChokepoint.isPending || updateChokepoint.isPending}
        deleting={deleteChokepoint.isPending}
        error={chokepointError}
        notice={chokepointNotice}
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

      {/* ── Asset allocation summary ──────────────────────────────────────── */}
      <section style={{ marginBottom: 28 }}>
        <h3 className="bp6-heading" style={{ fontSize: 14, marginBottom: 10, color: 'var(--bp6-text-muted-color)' }}>
          ASSET STATUS
        </h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          {([
            { label: 'Total',      value: assetCounts.total,     intent: 'none'    },
            { label: 'Available',  value: assetCounts.available,  intent: 'success' },
            { label: 'Assigned',   value: assetCounts.assigned,   intent: 'primary' },
            { label: 'Degraded',   value: assetCounts.degraded,   intent: 'warning' },
            { label: 'Offline',    value: assetCounts.offline,    intent: 'danger'  },
          ] as const).map(({ label, value, intent }) => (
            <div key={label} style={{ textAlign: 'center', minWidth: 72 }}>
              <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{value}</div>
              <Tag minimal intent={intent === 'none' ? undefined : intent} style={{ fontSize: 11, marginTop: 4 }}>
                {label}
              </Tag>
            </div>
          ))}
        </div>

        {allocatedAssets.length > 0 && (
          <>
            <h3 className="bp6-heading" style={{ fontSize: 14, marginBottom: 10, color: 'var(--bp6-text-muted-color)' }}>
              ASSET ALLOCATION
            </h3>
            <HTMLTable compact bordered style={{ width: '100%', maxWidth: 900, marginBottom: 20 }}>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Assigned Task(s)</th>
                  <th>Site</th>
                </tr>
              </thead>
              <tbody>
                {allocatedAssets.map(asset => {
                  const assignedTasks = assetTaskMap.get(asset.id) ?? []
                  const conflict = assignedTasks.length > 1
                  const STATUS_INTENT: Record<string, 'success' | 'primary' | 'warning' | 'danger' | undefined> = {
                    available: 'success', assigned: 'primary', degraded: 'warning', offline: 'danger',
                  }
                  return (
                    <tr key={asset.id} style={conflict ? { background: 'rgba(219,55,55,0.08)' } : undefined}>
                      <td style={{ fontWeight: 500 }}>
                        {conflict && (
                          <Tag minimal intent="danger" style={{ marginRight: 6, fontSize: 10 }}>CONFLICT</Tag>
                        )}
                        <span
                          style={{ cursor: 'pointer' }}
                          onClick={() => setEntityCard({ type: 'asset', id: asset.id })}
                        >
                          {asset.name}
                        </span>
                      </td>
                      <td className="bp6-text-muted" style={{ fontSize: 12 }}>{humanize(asset.asset_type)}</td>
                      <td>
                        <Tag minimal intent={STATUS_INTENT[asset.status]} style={{ fontSize: 11 }}>
                          {humanize(asset.status)}
                        </Tag>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {assignedTasks.map((t, i) => (
                          <span key={t.id}>
                            {i > 0 && <span style={{ margin: '0 4px', color: 'var(--bp6-text-muted-color)' }}>·</span>}
                            <Tag minimal intent={PRIORITY_INTENT[t.priority]} style={{ fontSize: 11, marginRight: 2 }}>
                              {humanize(t.priority)}
                            </Tag>
                            {t.title}
                          </span>
                        ))}
                      </td>
                      <td className="bp6-text-muted" style={{ fontSize: 12 }}>
                        {assignedTasks[0]?.site_name ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </HTMLTable>
          </>
        )}

        {areas_of_operation.length > 0 && (
          <>
            <h3 className="bp6-heading" style={{ fontSize: 14, marginBottom: 10, color: 'var(--bp6-text-muted-color)' }}>
              AO TASK COVERAGE
            </h3>
            <HTMLTable compact bordered style={{ width: '100%', maxWidth: 700 }}>
              <thead>
                <tr>
                  <th>Area of Operation</th>
                  <th>Posture</th>
                  <th style={{ textAlign: 'right' }}>Open Tasks</th>
                  <th style={{ textAlign: 'right' }}>Covered</th>
                  <th style={{ textAlign: 'right' }}>Uncovered</th>
                </tr>
              </thead>
              <tbody>
                {areas_of_operation.map(ao => {
                  const cov = aoCoverage.get(ao.id) ?? { open: 0, covered: 0 }
                  const uncovered = cov.open - cov.covered
                  return (
                    <tr key={ao.id}>
                      <td>{ao.name}</td>
                      <td><PostureBadge posture={ao.posture} /></td>
                      <td style={{ textAlign: 'right' }}>{cov.open}</td>
                      <td style={{ textAlign: 'right' }}>
                        <Tag minimal intent={cov.covered > 0 ? 'success' : 'none'} style={{ fontSize: 11 }}>
                          {cov.covered}
                        </Tag>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {uncovered > 0
                          ? <Tag minimal intent="warning" style={{ fontSize: 11 }}>{uncovered}</Tag>
                          : <span className="bp6-text-muted">0</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </HTMLTable>
          </>
        )}

        {siteCoverageRows.length > 0 && (
          <>
            <h3 className="bp6-heading" style={{ fontSize: 14, marginBottom: 10, marginTop: 20, color: 'var(--bp6-text-muted-color)' }}>
              LIVE / PROJECTED SITE SENSOR COVERAGE
            </h3>
            <HTMLTable compact bordered style={{ width: '100%', maxWidth: 980 }}>
              <thead>
                <tr>
                  <th>Site</th>
                  <th>AO / Posture</th>
                  <th style={{ textAlign: 'right' }}>Open Tasks</th>
                  <th>Coverage</th>
                  <th>Projected From</th>
                </tr>
              </thead>
              <tbody>
                {siteCoverageRows.map(({ site, area, circles, openTaskCount, criticalGap }) => (
                  <tr key={site.id} style={criticalGap ? { background: 'rgba(219,55,55,0.08)' } : undefined}>
                    <td style={{ fontWeight: 500 }}>{site.name}</td>
                    <td>
                      {area ? <PostureBadge posture={area.posture} /> : <span className="bp6-text-muted" style={{ fontSize: 11 }}>No AO</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{openTaskCount}</td>
                    <td>
                      {circles.length === 0 ? (
                        <Tag minimal intent={criticalGap ? 'danger' : 'warning'} style={{ fontSize: 11 }}>
                          {criticalGap ? 'Uncovered critical gap' : 'Uncovered'}
                        </Tag>
                      ) : (
                        <>
                          <Tag minimal intent="success" style={{ fontSize: 11, marginRight: 6 }}>
                            Covered by {circles.length}
                          </Tag>
                          {circles.some(circle => circle.status === 'degraded') && (
                            <Tag minimal intent="warning" style={{ fontSize: 11 }}>
                              degraded footprint
                            </Tag>
                          )}
                        </>
                      )}
                    </td>
                    <td className="bp6-text-muted" style={{ fontSize: 12 }}>
                      {circles.length === 0
                        ? '—'
                        : circles.slice(0, 3).map(circle => `${circle.assetName} @ ${circle.anchorLabel}`).join(' · ')
                      }
                      {circles.length > 3 && ` · +${circles.length - 3} more`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </HTMLTable>
          </>
        )}
      </section>

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

      {/* ── Planning board ────────────────────────────────────────────────── */}
      <section>
        <h3 className="bp6-heading" style={{ fontSize: 14, marginBottom: 10, color: 'var(--bp6-text-muted-color)' }}>
          OPEN TASKS — {tasks.length} total
        </h3>
        {tasks.length === 0 ? (
          <NonIdealState icon="tick-circle" title="No open tasks" description="All tasks are resolved." />
        ) : (
          <HTMLTable compact bordered interactive style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Site</th>
                <th>AO / Posture</th>
                <th>Priority</th>
                <th>Status</th>
                <th style={{ minWidth: 200 }}>Assigned Asset</th>
              </tr>
            </thead>
            <tbody>
              {sortedTasks.map(task => {
                const pending = pendingAssets[task.id]
                const isMutating = updateTask.isPending && updateTask.variables?.id === task.id
                return (
                  <tr key={task.id}>
                    <td>
                      <span
                        style={{ cursor: 'pointer', fontWeight: 500 }}
                        onClick={() => setEntityCard({ type: 'task', id: task.id })}
                        title={task.description ?? undefined}
                      >
                        {task.title}
                      </span>
                    </td>
                    <td className="bp6-text-muted" style={{ fontSize: 12 }}>
                      {task.site_name ?? '—'}
                    </td>
                    <td>
                      {task.ao_posture
                        ? <PostureBadge posture={task.ao_posture as Posture} />
                        : <span className="bp6-text-muted" style={{ fontSize: 11 }}>No AO</span>
                      }
                    </td>
                    <td>
                      <Tag minimal intent={PRIORITY_INTENT[task.priority]} style={{ fontSize: 11 }}>
                        {humanize(task.priority)}
                      </Tag>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {humanize(task.workflow_status)}
                    </td>
                    <td>
                      <AssetPicker
                        minimal
                        currentAssetId={task.asset_id}
                        assets={assets}
                        assignedTasks={tasks}
                        pendingAsset={pending}
                        onPendingChange={assetId => handlePendingChange(task.id, assetId)}
                        onConfirm={assetId => handleConfirm(task.id, assetId)}
                        isPending={isMutating}
                        posture={task.ao_posture as Posture | undefined ?? undefined}
                      />
                      {pending !== undefined && pending !== task.asset_id && !isMutating && !isReplaying && (
                        <button
                          className="bp6-button bp6-small bp6-intent-primary"
                          style={{ marginLeft: 6 }}
                          onClick={() => handleConfirm(task.id, pending)}
                        >
                          Assign
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </HTMLTable>
        )}
      </section>
    </div>
  )
}
