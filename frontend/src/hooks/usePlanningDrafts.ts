import { useEffect, useMemo, useState } from 'react'
import {
  makeDefaultObservedAt,
  sameChokepointDraft,
  sameIntentDraft,
  samePaceDraft,
  sameSaluteDraft,
  type ChokepointDraft,
  type IntentDraft,
  type PaceDraft,
  type SaluteDraft,
} from '../lib/planningPageUtils'
import type {
  Chokepoint,
  CommanderIntent,
  PacePlan,
  PlanningAoStub,
  Site,
} from '../api/types'

interface UsePlanningDraftsInput {
  areasOfOperation: PlanningAoStub[]
  chokepoints: Chokepoint[]
  commanderIntents: CommanderIntent[]
  pacePlans: PacePlan[]
  sites: Site[]
}

export function usePlanningDrafts({
  areasOfOperation,
  chokepoints,
  commanderIntents,
  pacePlans,
  sites,
}: UsePlanningDraftsInput) {
  // ── AO selection ─────────────────────────────────────────────────────────
  const [selectedDoctrineAoId, setSelectedDoctrineAoId] = useState<string>('')

  const aoIdsKey = areasOfOperation.map(ao => ao.id).join('|')
  // aoIdsKey is a stable string identity proxy for areasOfOperation; intentional missing dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const doctrineAoIds = useMemo(() => areasOfOperation.map(ao => ao.id), [aoIdsKey])
  const firstDoctrineAoId = areasOfOperation[0]?.id ?? ''

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
    () => areasOfOperation.find(ao => ao.id === selectedDoctrineAoId) ?? null,
    [areasOfOperation, selectedDoctrineAoId],
  )

  // ── Lookup maps ──────────────────────────────────────────────────────────
  const commanderIntentsByAo = useMemo(
    () => new Map(commanderIntents.map(intent => [intent.area_of_operation_id, intent])),
    [commanderIntents],
  )
  const pacePlansByAo = useMemo(
    () => new Map(pacePlans.map(plan => [plan.area_of_operation_id, plan])),
    [pacePlans],
  )

  const selectedCommanderIntent = useMemo(
    () => (selectedDoctrineAoId ? (commanderIntentsByAo.get(selectedDoctrineAoId) ?? null) : null),
    [commanderIntentsByAo, selectedDoctrineAoId],
  )
  const selectedPacePlan = useMemo(
    () => (selectedDoctrineAoId ? (pacePlansByAo.get(selectedDoctrineAoId) ?? null) : null),
    [pacePlansByAo, selectedDoctrineAoId],
  )

  // ── Filtered doctrine data ───────────────────────────────────────────────
  const doctrineSites = useMemo(
    () => sites.filter(site => site.area_of_operation_id === selectedDoctrineAoId),
    [sites, selectedDoctrineAoId],
  )
  const doctrineChokepoints = useMemo(
    () => chokepoints.filter(point => point.area_of_operation_id === selectedDoctrineAoId),
    [chokepoints, selectedDoctrineAoId],
  )

  const firstDoctrineSiteId = doctrineSites[0]?.id ?? ''
  const firstDoctrineSite = doctrineSites[0] ?? null

  // ── Intent draft ─────────────────────────────────────────────────────────
  const [intentDraft, setIntentDraft] = useState<IntentDraft>({
    title: '', objective: '', end_state: '', constraints: '',
  })
  const [intentError, setIntentError] = useState<string | null>(null)
  const [intentNotice, setIntentNotice] = useState<string | null>(null)

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

  useEffect(() => {
    setIntentDraft(current => (sameIntentDraft(current, nextIntentDraft) ? current : nextIntentDraft))
    setIntentError(null)
  }, [nextIntentDraft])

  // ── PACE draft ───────────────────────────────────────────────────────────
  const [paceDraft, setPaceDraft] = useState<PaceDraft>({
    primary_plan: '', alternate_plan: '', contingency_plan: '', emergency_plan: '', notes: '',
  })
  const [paceError, setPaceError] = useState<string | null>(null)
  const [paceNotice, setPaceNotice] = useState<string | null>(null)

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

  useEffect(() => {
    setPaceDraft(current => (samePaceDraft(current, nextPaceDraft) ? current : nextPaceDraft))
    setPaceError(null)
  }, [nextPaceDraft])

  // ── SALUTE draft ─────────────────────────────────────────────────────────
  const [saluteDraft, setSaluteDraft] = useState<SaluteDraft>({
    site_id: '', size: '', activity: '', location: '', unit: '', observed_at: '', equipment: '', remarks: '',
  })
  const [saluteError, setSaluteError] = useState<string | null>(null)
  const [saluteNotice, setSaluteNotice] = useState<string | null>(null)

  const doctrineSiteIdsKey = doctrineSites.map(site => site.id).join('|')
  const nextSaluteDraft = useMemo(() => ({
    site_id: firstDoctrineSiteId,
    size: '', activity: '', location: '', unit: '',
    observed_at: makeDefaultObservedAt(),
    equipment: '', remarks: '',
  // doctrineSiteIdsKey + selectedDoctrineAoId are AO-switch and site-list guards; not read in body.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [selectedDoctrineAoId, doctrineSiteIdsKey, firstDoctrineSiteId])

  useEffect(() => {
    setSaluteDraft(current => (sameSaluteDraft(current, nextSaluteDraft) ? current : nextSaluteDraft))
    setSaluteError(null)
  }, [nextSaluteDraft])

  // ── Chokepoint draft ─────────────────────────────────────────────────────
  const [selectedChokepointId, setSelectedChokepointId] = useState<string>('')
  const [pendingSelectedChokepoint, setPendingSelectedChokepoint] = useState<Chokepoint | null>(null)
  const [chokepointDraft, setChokepointDraft] = useState<ChokepointDraft>({
    name: '', category: 'strait', status: 'monitor',
    latitude: '', longitude: '', watch_radius_km: '25', notes: '',
  })
  const [chokepointError, setChokepointError] = useState<string | null>(null)
  const [chokepointNotice, setChokepointNotice] = useState<string | null>(null)

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

  // ── AO change handler ────────────────────────────────────────────────────
  function handleDoctrineAoChange(areaOfOperationId: string) {
    setSelectedDoctrineAoId(areaOfOperationId)
    setPendingSelectedChokepoint(null)
    setIntentNotice(null)
    setPaceNotice(null)
    setSaluteNotice(null)
    setChokepointNotice(null)
  }

  // ── Reset SALUTE draft (called after successful submit) ──────────────────
  function resetSaluteDraft() {
    setSaluteDraft({
      site_id: firstDoctrineSiteId,
      size: '', activity: '', location: '', unit: '',
      observed_at: makeDefaultObservedAt(),
      equipment: '', remarks: '',
    })
  }

  return {
    // AO selection
    selectedDoctrineAoId,
    selectedDoctrineAo,
    handleDoctrineAoChange,

    // Doctrine lookups
    selectedCommanderIntent,
    selectedPacePlan,
    doctrineSites,
    doctrineChokepoints,

    // Intent
    intentDraft, setIntentDraft,
    intentError, setIntentError,
    intentNotice, setIntentNotice,

    // PACE
    paceDraft, setPaceDraft,
    paceError, setPaceError,
    paceNotice, setPaceNotice,

    // SALUTE
    saluteDraft, setSaluteDraft,
    saluteError, setSaluteError,
    saluteNotice, setSaluteNotice,
    resetSaluteDraft,

    // Chokepoint
    selectedChokepointId, setSelectedChokepointId,
    selectedChokepoint,
    pendingSelectedChokepoint, setPendingSelectedChokepoint,
    chokepointDraft, setChokepointDraft,
    chokepointError, setChokepointError,
    chokepointNotice, setChokepointNotice,
  }
}
