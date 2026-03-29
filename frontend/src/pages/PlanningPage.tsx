import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Callout,
  Card,
  Drawer,
  DrawerSize,
  FormGroup,
  HTMLTable,
  HTMLSelect,
  InputGroup,
  NonIdealState,
  Spinner,
  Tag,
  TextArea,
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
import { useReplay } from '../context/ReplayContext'
import { humanize } from '../utils/humanize'
import { computeFlags } from '../utils/planningFlags'
import { buildCoverageCircles, coverageBySite } from '../lib/coverage'
import { useTelemetry } from '../hooks/useTelemetry'
import { getApiErrorMessage } from '../api/client'
import type { Chokepoint, ChokepointCategory, ChokepointStatus, Posture, TaskPriority } from '../api/types'
import type { EntityType } from '../components/EntityCard'

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high:     1,
  normal:   2,
  low:      3,
}

const PRIORITY_INTENT: Record<TaskPriority, 'danger' | 'warning' | 'primary' | 'none'> = {
  critical: 'danger',
  high:     'warning',
  normal:   'primary',
  low:      'none',
}

const CHOKEPOINT_CATEGORY_OPTIONS: Array<{ value: ChokepointCategory; label: string }> = [
  { value: 'strait', label: 'Strait' },
  { value: 'canal', label: 'Canal' },
  { value: 'harbor_approach', label: 'Harbor approach' },
  { value: 'lane_constriction', label: 'Lane constriction' },
  { value: 'anchorage', label: 'Anchorage' },
]

const CHOKEPOINT_STATUS_OPTIONS: Array<{ value: ChokepointStatus; label: string }> = [
  { value: 'monitor', label: 'Monitor' },
  { value: 'constrained', label: 'Constrained' },
  { value: 'contested', label: 'Contested' },
  { value: 'closed', label: 'Closed' },
]

function makeDefaultObservedAt() {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
}

function sameIntentDraft(
  left: { title: string; objective: string; end_state: string; constraints: string },
  right: { title: string; objective: string; end_state: string; constraints: string },
) {
  return left.title === right.title &&
    left.objective === right.objective &&
    left.end_state === right.end_state &&
    left.constraints === right.constraints
}

function samePaceDraft(
  left: {
    primary_plan: string
    alternate_plan: string
    contingency_plan: string
    emergency_plan: string
    notes: string
  },
  right: {
    primary_plan: string
    alternate_plan: string
    contingency_plan: string
    emergency_plan: string
    notes: string
  },
) {
  return left.primary_plan === right.primary_plan &&
    left.alternate_plan === right.alternate_plan &&
    left.contingency_plan === right.contingency_plan &&
    left.emergency_plan === right.emergency_plan &&
    left.notes === right.notes
}

function sameSaluteDraft(
  left: {
    site_id: string
    size: string
    activity: string
    location: string
    unit: string
    observed_at: string
    equipment: string
    remarks: string
  },
  right: {
    site_id: string
    size: string
    activity: string
    location: string
    unit: string
    observed_at: string
    equipment: string
    remarks: string
  },
) {
  return left.site_id === right.site_id &&
    left.size === right.size &&
    left.activity === right.activity &&
    left.location === right.location &&
    left.unit === right.unit &&
    left.observed_at === right.observed_at &&
    left.equipment === right.equipment &&
    left.remarks === right.remarks
}

function sameChokepointDraft(
  left: {
    name: string
    category: ChokepointCategory
    status: ChokepointStatus
    latitude: string
    longitude: string
    watch_radius_km: string
    notes: string
  },
  right: {
    name: string
    category: ChokepointCategory
    status: ChokepointStatus
    latitude: string
    longitude: string
    watch_radius_km: string
    notes: string
  },
) {
  return left.name === right.name &&
    left.category === right.category &&
    left.status === right.status &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude &&
    left.watch_radius_km === right.watch_radius_km &&
    left.notes === right.notes
}

export default function PlanningPage() {
  const { isCommander } = useRole()
  const { isReplaying } = useReplay()
  const navigate = useNavigate()
  const { data, isLoading, isError } = usePlanning(isCommander && !isReplaying)
  const sitesQuery = useSites({ per_page: 200 }, isCommander && !isReplaying)
  const updateTask = useUpdateTask()
  const createCommanderIntent = useCreateCommanderIntent()
  const updateCommanderIntent = useUpdateCommanderIntent()
  const createPacePlan = useCreatePacePlan()
  const updatePacePlan = useUpdatePacePlan()
  const createSaluteReport = useCreateSaluteReport()
  const createChokepoint = useCreateChokepoint()
  const updateChokepoint = useUpdateChokepoint()
  const deleteChokepoint = useDeleteChokepoint()
  const { readings } = useTelemetry(isCommander && !isReplaying)

  // Per-row pending asset selection — keyed by task id
  const [pendingAssets, setPendingAssets] = useState<Record<string, string | null | undefined>>({})
  const [entityCard, setEntityCard] = useState<{ type: EntityType; id: string } | null>(null)
  const [selectedDoctrineAoId, setSelectedDoctrineAoId] = useState<string>('')
  const [intentDraft, setIntentDraft] = useState({
    title: '',
    objective: '',
    end_state: '',
    constraints: '',
  })
  const [paceDraft, setPaceDraft] = useState({
    primary_plan: '',
    alternate_plan: '',
    contingency_plan: '',
    emergency_plan: '',
    notes: '',
  })
  const [saluteDraft, setSaluteDraft] = useState({
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
  const [chokepointDraft, setChokepointDraft] = useState({
    name: '',
    category: 'strait' as ChokepointCategory,
    status: 'monitor' as ChokepointStatus,
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
      incidents_truncated: false,
      incident_count: 0,
      salute_reports_truncated: false,
      salute_report_count: 0,
      salute_report_meta_by_ao: {},
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

  if (isReplaying) {
    return (
      <div style={{ padding: '20px 24px', maxWidth: 960 }}>
        <Callout intent="warning" icon="history" style={{ marginBottom: 16 }}>
          Operational planning is unavailable during replay because the planning dataset, AO posture state, and task-allocation workflow are live-only.
        </Callout>
        <NonIdealState
          icon="timeline-events"
          title="Planning unavailable in replay"
          description="Replay mode does not yet support historical planning snapshots or safe task-allocation actions."
        />
      </div>
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
      <div style={{ marginBottom: 24 }}>
        <h2 className="bp6-heading" style={{ margin: 0 }}>Operational Planning Surface</h2>
        <span className="bp6-text-muted" style={{ fontSize: 13 }}>
          Cross-site task coverage · asset allocation · ROE posture
        </span>
      </div>

      <section style={{ marginBottom: 28 }}>
        <h3 className="bp6-heading" style={{ fontSize: 14, marginBottom: 10, color: 'var(--bp6-text-muted-color)' }}>
          COMMANDER DOCTRINE
        </h3>
        {areas_of_operation.length === 0 ? (
          <Callout intent="warning" compact>
            Create an area of operation before recording commander intent, PACE, or SALUTE doctrine.
          </Callout>
        ) : (
          <>
            <div style={{ marginBottom: 16, maxWidth: 320 }}>
              <FormGroup label="Area of operation" inline>
                <HTMLSelect
                  fill
                  value={selectedDoctrineAoId}
                  onChange={e => handleDoctrineAoChange(e.target.value)}
                  options={areas_of_operation.map(ao => ({ label: ao.name, value: ao.id }))}
                />
              </FormGroup>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 16 }}>
              <Card style={{ background: 'rgba(255,255,255,0.02)' }}>
                <h4 className="bp6-heading" style={{ marginTop: 0, marginBottom: 12 }}>Commander Intent</h4>
                {selectedDoctrineAo && (
                  <div className="bp6-text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
                    {selectedDoctrineAo.name} · {humanize(selectedDoctrineAo.posture)}
                  </div>
                )}
                <FormGroup label="Intent title" labelFor="commander-intent-title">
                  <InputGroup
                    id="commander-intent-title"
                    value={intentDraft.title}
                    onChange={e => setIntentDraft(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Secure northern shipping corridor"
                  />
                </FormGroup>
                <FormGroup label="Objective" labelFor="commander-intent-objective">
                  <TextArea
                    id="commander-intent-objective"
                    fill
                    rows={4}
                    value={intentDraft.objective}
                    onChange={e => setIntentDraft(prev => ({ ...prev, objective: e.target.value }))}
                    placeholder="What must the force accomplish in this AO?"
                  />
                </FormGroup>
                <FormGroup label="End state" labelFor="commander-intent-end-state">
                  <TextArea
                    id="commander-intent-end-state"
                    fill
                    rows={4}
                    value={intentDraft.end_state}
                    onChange={e => setIntentDraft(prev => ({ ...prev, end_state: e.target.value }))}
                    placeholder="Describe the desired operational picture when this intent is satisfied."
                  />
                </FormGroup>
                <FormGroup label="Constraints" labelFor="commander-intent-constraints">
                  <TextArea
                    id="commander-intent-constraints"
                    fill
                    rows={3}
                    value={intentDraft.constraints}
                    onChange={e => setIntentDraft(prev => ({ ...prev, constraints: e.target.value }))}
                    placeholder="Operational or political constraints, ROE limitations, civilian concerns."
                  />
                </FormGroup>
                {intentError && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{intentError}</Callout>}
                {intentNotice && <Callout intent="success" compact style={{ marginBottom: 12 }}>{intentNotice}</Callout>}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <span className="bp6-text-muted" style={{ fontSize: 12 }}>
                    {selectedCommanderIntent ? `Last updated ${new Date(selectedCommanderIntent.updated_at).toLocaleString()}` : 'No intent recorded yet'}
                  </span>
                  <Button
                    intent="primary"
                    loading={createCommanderIntent.isPending || updateCommanderIntent.isPending}
                    onClick={handleIntentSave}
                  >
                    Save commander intent
                  </Button>
                </div>
              </Card>

              <Card style={{ background: 'rgba(255,255,255,0.02)' }}>
                <h4 className="bp6-heading" style={{ marginTop: 0, marginBottom: 12 }}>PACE Plan</h4>
                <FormGroup label="Primary" labelFor="pace-primary">
                  <InputGroup
                    id="pace-primary"
                    value={paceDraft.primary_plan}
                    onChange={e => setPaceDraft(prev => ({ ...prev, primary_plan: e.target.value }))}
                    placeholder="SATCOM mission chat"
                  />
                </FormGroup>
                <FormGroup label="Alternate" labelFor="pace-alternate">
                  <InputGroup
                    id="pace-alternate"
                    value={paceDraft.alternate_plan}
                    onChange={e => setPaceDraft(prev => ({ ...prev, alternate_plan: e.target.value }))}
                    placeholder="Secure VHF relay"
                  />
                </FormGroup>
                <FormGroup label="Contingency" labelFor="pace-contingency">
                  <InputGroup
                    id="pace-contingency"
                    value={paceDraft.contingency_plan}
                    onChange={e => setPaceDraft(prev => ({ ...prev, contingency_plan: e.target.value }))}
                    placeholder="Burst SMS via field gateway"
                  />
                </FormGroup>
                <FormGroup label="Emergency" labelFor="pace-emergency">
                  <InputGroup
                    id="pace-emergency"
                    value={paceDraft.emergency_plan}
                    onChange={e => setPaceDraft(prev => ({ ...prev, emergency_plan: e.target.value }))}
                    placeholder="HF voice net or courier fallback"
                  />
                </FormGroup>
                <FormGroup label="Notes" labelFor="pace-notes">
                  <TextArea
                    id="pace-notes"
                    fill
                    rows={3}
                    value={paceDraft.notes}
                    onChange={e => setPaceDraft(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Escalation thresholds, relay assumptions, or network caveats."
                  />
                </FormGroup>
                {paceError && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{paceError}</Callout>}
                {paceNotice && <Callout intent="success" compact style={{ marginBottom: 12 }}>{paceNotice}</Callout>}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <span className="bp6-text-muted" style={{ fontSize: 12 }}>
                    {selectedPacePlan ? `Last updated ${new Date(selectedPacePlan.updated_at).toLocaleString()}` : 'No PACE plan recorded yet'}
                  </span>
                  <Button
                    intent="primary"
                    loading={createPacePlan.isPending || updatePacePlan.isPending}
                    onClick={handlePaceSave}
                  >
                    Save PACE plan
                  </Button>
                </div>
              </Card>
            </div>

            <Card style={{ marginBottom: 16, background: 'rgba(255,255,255,0.02)' }}>
              <h4 className="bp6-heading" style={{ marginTop: 0, marginBottom: 12 }}>SALUTE Report</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <FormGroup label="Site" labelFor="salute-site">
                  <HTMLSelect
                    id="salute-site"
                    fill
                    value={saluteDraft.site_id}
                    onChange={e => setSaluteDraft(prev => ({ ...prev, site_id: e.target.value }))}
                    options={[
                      { label: 'Area-wide / not site-specific', value: '' },
                      ...doctrineSites.map(site => ({ label: site.name, value: site.id })),
                    ]}
                  />
                </FormGroup>
                <FormGroup label="Size" labelFor="salute-size">
                  <InputGroup
                    id="salute-size"
                    value={saluteDraft.size}
                    onChange={e => setSaluteDraft(prev => ({ ...prev, size: e.target.value }))}
                    placeholder="2 fast boats"
                  />
                </FormGroup>
                <FormGroup label="Unit" labelFor="salute-unit">
                  <InputGroup
                    id="salute-unit"
                    value={saluteDraft.unit}
                    onChange={e => setSaluteDraft(prev => ({ ...prev, unit: e.target.value }))}
                    placeholder="Unknown irregular maritime element"
                  />
                </FormGroup>
                <FormGroup label="Time observed" labelFor="salute-observed-at">
                  <InputGroup
                    id="salute-observed-at"
                    type="datetime-local"
                    value={saluteDraft.observed_at}
                    onChange={e => setSaluteDraft(prev => ({ ...prev, observed_at: e.target.value }))}
                  />
                </FormGroup>
              </div>
              <FormGroup label="Activity" labelFor="salute-activity">
                <TextArea
                  id="salute-activity"
                  fill
                  rows={3}
                  value={saluteDraft.activity}
                  onChange={e => setSaluteDraft(prev => ({ ...prev, activity: e.target.value }))}
                  placeholder="Describe what the observed element is doing."
                />
              </FormGroup>
              <FormGroup label="Location" labelFor="salute-location">
                <TextArea
                  id="salute-location"
                  fill
                  rows={2}
                  value={saluteDraft.location}
                  onChange={e => setSaluteDraft(prev => ({ ...prev, location: e.target.value }))}
                  placeholder="Grid, landmark, lane, harbor, or route description."
                />
              </FormGroup>
              <FormGroup label="Equipment" labelFor="salute-equipment">
                <TextArea
                  id="salute-equipment"
                  fill
                  rows={2}
                  value={saluteDraft.equipment}
                  onChange={e => setSaluteDraft(prev => ({ ...prev, equipment: e.target.value }))}
                  placeholder="Observed kit, comms, armament, or sensor packages."
                />
              </FormGroup>
              <FormGroup label="Remarks" labelFor="salute-remarks">
                <TextArea
                  id="salute-remarks"
                  fill
                  rows={2}
                  value={saluteDraft.remarks}
                  onChange={e => setSaluteDraft(prev => ({ ...prev, remarks: e.target.value }))}
                  placeholder="Assessment, caveats, or follow-on collection needs."
                />
              </FormGroup>
              {saluteError && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{saluteError}</Callout>}
              {saluteNotice && <Callout intent="success" compact style={{ marginBottom: 12 }}>{saluteNotice}</Callout>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <span className="bp6-text-muted" style={{ fontSize: 12 }}>
                  {selectedDoctrineAo ? `${selectedDoctrineAo.name} · ${doctrineSaluteReports.length} recent report${doctrineSaluteReports.length === 1 ? '' : 's'}` : 'Select an area of operation'}
                </span>
                <Button
                  intent="primary"
                  loading={createSaluteReport.isPending}
                  onClick={handleSaluteSubmit}
                >
                  Submit SALUTE report
                </Button>
              </div>
            </Card>

            {doctrineSaluteMeta.truncated && (
              <Callout intent="warning" icon="history" compact style={{ marginBottom: 12 }}>
                Showing the most recent {doctrineSaluteMeta.count} SALUTE reports for this area of operation.
              </Callout>
            )}

            <HTMLTable compact bordered style={{ width: '100%', maxWidth: 1200 }}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Site</th>
                  <th>Size</th>
                  <th>Activity</th>
                  <th>Unit</th>
                  <th>Location</th>
                  <th>Equipment</th>
                </tr>
              </thead>
              <tbody>
                {doctrineSaluteReports.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="bp6-text-muted" style={{ fontSize: 12 }}>
                      No SALUTE reports recorded for this area of operation yet.
                    </td>
                  </tr>
                ) : (
                  doctrineSaluteReports.map(report => (
                    <tr key={report.id}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                        {new Date(report.observed_at).toLocaleString()}
                      </td>
                      <td style={{ fontSize: 12 }}>{report.site_name ?? 'AO-wide'}</td>
                      <td style={{ fontSize: 12 }}>{report.size || '—'}</td>
                      <td style={{ fontSize: 12 }}>{report.activity}</td>
                      <td style={{ fontSize: 12 }}>{report.unit || '—'}</td>
                      <td style={{ fontSize: 12 }}>{report.location}</td>
                      <td style={{ fontSize: 12 }}>{report.equipment || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </HTMLTable>
          </>
        )}
      </section>

      <section style={{ marginBottom: 28 }}>
        <h3 className="bp6-heading" style={{ fontSize: 14, marginBottom: 10, color: 'var(--bp6-text-muted-color)' }}>
          MARITIME CHOKEPOINTS
        </h3>
        {areas_of_operation.length === 0 ? (
          <Callout intent="warning" compact>
            Create an area of operation before recording monitored straits, canals, or harbor approaches.
          </Callout>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 420px) minmax(0, 1fr)', gap: 16 }}>
            <Card style={{ background: 'rgba(255,255,255,0.02)' }}>
              <FormGroup label="Area of operation" inline>
                <HTMLSelect
                  fill
                  value={selectedDoctrineAoId}
                  onChange={e => handleDoctrineAoChange(e.target.value)}
                  options={areas_of_operation.map(ao => ({ label: ao.name, value: ao.id }))}
                />
              </FormGroup>
              <FormGroup label="Editing" labelFor="chokepoint-editing">
                <HTMLSelect
                  id="chokepoint-editing"
                  fill
                  value={selectedChokepointId}
                  onChange={e => {
                    setPendingSelectedChokepoint(null)
                    setSelectedChokepointId(e.target.value)
                    setChokepointNotice(null)
                    setChokepointError(null)
                  }}
                  options={[
                    { label: 'New chokepoint', value: '' },
                    ...(
                      pendingSelectedChokepoint &&
                      pendingSelectedChokepoint.area_of_operation_id === selectedDoctrineAoId &&
                      !doctrineChokepoints.some(point => point.id === pendingSelectedChokepoint.id)
                        ? [{ label: pendingSelectedChokepoint.name, value: pendingSelectedChokepoint.id }]
                        : []
                    ),
                    ...doctrineChokepoints.map(point => ({ label: point.name, value: point.id })),
                  ]}
                />
              </FormGroup>
              <FormGroup label="Name" labelFor="chokepoint-name">
                <InputGroup
                  id="chokepoint-name"
                  value={chokepointDraft.name}
                  onChange={e => setChokepointDraft(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Hormuz outbound lane"
                />
              </FormGroup>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <FormGroup label="Category" labelFor="chokepoint-category">
                  <HTMLSelect
                    id="chokepoint-category"
                    fill
                    value={chokepointDraft.category}
                    onChange={e => setChokepointDraft(prev => ({ ...prev, category: e.target.value as ChokepointCategory }))}
                    options={CHOKEPOINT_CATEGORY_OPTIONS.map(option => ({ label: option.label, value: option.value }))}
                  />
                </FormGroup>
                <FormGroup label="Status" labelFor="chokepoint-status">
                  <HTMLSelect
                    id="chokepoint-status"
                    fill
                    value={chokepointDraft.status}
                    onChange={e => setChokepointDraft(prev => ({ ...prev, status: e.target.value as ChokepointStatus }))}
                    options={CHOKEPOINT_STATUS_OPTIONS.map(option => ({ label: option.label, value: option.value }))}
                  />
                </FormGroup>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <FormGroup label="Latitude" labelFor="chokepoint-latitude">
                  <InputGroup
                    id="chokepoint-latitude"
                    value={chokepointDraft.latitude}
                    onChange={e => setChokepointDraft(prev => ({ ...prev, latitude: e.target.value }))}
                    placeholder="25.285447"
                  />
                </FormGroup>
                <FormGroup label="Longitude" labelFor="chokepoint-longitude">
                  <InputGroup
                    id="chokepoint-longitude"
                    value={chokepointDraft.longitude}
                    onChange={e => setChokepointDraft(prev => ({ ...prev, longitude: e.target.value }))}
                    placeholder="56.334457"
                  />
                </FormGroup>
                <FormGroup label="Watch radius (km)" labelFor="chokepoint-radius">
                  <InputGroup
                    id="chokepoint-radius"
                    value={chokepointDraft.watch_radius_km}
                    onChange={e => setChokepointDraft(prev => ({ ...prev, watch_radius_km: e.target.value }))}
                    placeholder="25"
                  />
                </FormGroup>
              </div>
              <FormGroup label="Notes" labelFor="chokepoint-notes">
                <TextArea
                  id="chokepoint-notes"
                  fill
                  rows={4}
                  value={chokepointDraft.notes}
                  onChange={e => setChokepointDraft(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Traffic restrictions, boarding pattern, ISR emphasis, or escalation thresholds."
                />
              </FormGroup>
              {chokepointError && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{chokepointError}</Callout>}
              {chokepointNotice && <Callout intent="success" compact style={{ marginBottom: 12 }}>{chokepointNotice}</Callout>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="bp6-text-muted" style={{ fontSize: 12 }}>
                  {selectedDoctrineAo ? `${selectedDoctrineAo.name} · ${doctrineChokepoints.length} chokepoint${doctrineChokepoints.length === 1 ? '' : 's'}` : 'Select an area of operation'}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {selectedChokepoint && (
                    <Button
                      intent="danger"
                      outlined
                      loading={deleteChokepoint.isPending}
                      onClick={handleChokepointDelete}
                    >
                      Delete
                    </Button>
                  )}
                  <Button
                    intent="primary"
                    loading={createChokepoint.isPending || updateChokepoint.isPending}
                    onClick={handleChokepointSave}
                  >
                    {selectedChokepoint ? 'Update chokepoint' : 'Create chokepoint'}
                  </Button>
                </div>
              </div>
            </Card>

            <Card style={{ background: 'rgba(255,255,255,0.02)' }}>
              <HTMLTable compact bordered style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Radius</th>
                    <th>Location</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {doctrineChokepoints.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="bp6-text-muted" style={{ fontSize: 12 }}>
                        No chokepoints recorded for this area of operation yet.
                      </td>
                    </tr>
                  ) : (
                    doctrineChokepoints.map(point => (
                      <tr key={point.id}>
                        <td style={{ fontSize: 12 }}>{point.name}</td>
                        <td style={{ fontSize: 12 }}>{humanize(point.category)}</td>
                        <td style={{ fontSize: 12 }}>
                          <Tag minimal intent={
                            point.status === 'closed' ? 'danger' :
                              point.status === 'contested' ? 'warning' :
                                point.status === 'constrained' ? 'primary' :
                                  'none'
                          }>
                            {humanize(point.status)}
                          </Tag>
                        </td>
                        <td style={{ fontSize: 12 }}>{point.watch_radius_km.toFixed(1)} km</td>
                        <td style={{ fontSize: 12 }}>{point.latitude.toFixed(3)}, {point.longitude.toFixed(3)}</td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(point.updated_at).toLocaleString()}</td>
                        <td style={{ fontSize: 12 }}>
                          <Button
                            small
                            minimal
                            icon="edit"
                            onClick={() => {
                              setPendingSelectedChokepoint(null)
                              setSelectedChokepointId(point.id)
                            }}
                          >
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </HTMLTable>
            </Card>
          </div>
        )}
      </section>

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
                      {pending !== undefined && pending !== task.asset_id && !isMutating && (
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
