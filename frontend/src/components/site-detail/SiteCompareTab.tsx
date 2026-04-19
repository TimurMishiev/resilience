import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Callout, Spinner } from '@blueprintjs/core'
import { getSite } from '../../api/sites'
import { getReadiness } from '../../api/readiness'
import type { Site, SiteReadiness } from '../../api/types'
import { diffSnapshots } from '../../utils/diffSnapshots'
import { toDatetimeLocal, fromDatetimeLocal } from '../../utils/datetimeLocal'
import SnapshotDiffView from '../SnapshotDiffView'

// Site fields that are immutable (id, created_at), volatile (updated_at), or
// numerically encoded as strings by the Rails decimal serializer in ways that
// would produce noisy string-vs-string deltas (latitude/longitude). The point
// of Slice 4c is to surface the site's operational state delta — posture,
// status, flag, geofence, AO assignment — not serialization churn.
const IGNORED_SITE_FIELDS = new Set<keyof Site | string>([
  'id',
  'created_at',
  'updated_at',
  'latitude',
  'longitude',
])

function stripIgnoredSiteFields(site: Site): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(site)) {
    if (IGNORED_SITE_FIELDS.has(key)) continue
    out[key] = value
  }
  return out
}

// Flatten the readiness counts into scalar `tasks_*` keys so the diff shows
// "tasks_resolved: 3 → 8" instead of an opaque nested JSON blob. The score
// is surfaced as `readiness_score` to disambiguate it from site fields.
function readinessSnapshot(readiness: SiteReadiness | null): Record<string, unknown> {
  if (!readiness) return {}
  return {
    readiness_score: readiness.score,
    tasks_total:       readiness.counts.total,
    tasks_resolved:    readiness.counts.resolved,
    tasks_blocked:     readiness.counts.blocked,
    tasks_in_progress: readiness.counts.in_progress,
    tasks_new:         readiness.counts.new,
    tasks_triaged:     readiness.counts.triaged,
  }
}

interface SiteCompareTabProps {
  siteId: string
  openedAt: string
  // Seed value for T2 — the operator can shift T2 freely; this is not an upper bound.
  defaultLatestAt: string
}

export default function SiteCompareTab({ siteId, openedAt, defaultLatestAt }: SiteCompareTabProps) {
  const [t1Input, setT1Input] = useState(() => toDatetimeLocal(openedAt))
  const [t2Input, setT2Input] = useState(() => toDatetimeLocal(defaultLatestAt))
  const [active, setActive] = useState<{ t1: string; t2: string } | null>(null)

  // Stale-compare guard: any input edit after Compare invalidates the window.
  // See matching comment in IncidentCompareTab — silent stale state on an operator
  // surface is a correctness failure, not just polish.
  function handleT1Change(value: string) {
    setT1Input(value)
    if (active) setActive(null)
  }
  function handleT2Change(value: string) {
    setT2Input(value)
    if (active) setActive(null)
  }

  // future: extract useSnapshotAtMoment(entityFetcher, id, asOf, enabled) when a
  // fourth compare surface appears (task-list, asset-list, cross-entity). One
  // slice isn't enough to justify the abstraction — wait for the next consumer.
  const site1 = useQuery({
    queryKey: ['sites', siteId, { as_of: active?.t1 }],
    queryFn: () => getSite(siteId, { as_of: active!.t1 }),
    enabled: !!active,
    refetchInterval: false,
  })
  const site2 = useQuery({
    queryKey: ['sites', siteId, { as_of: active?.t2 }],
    queryFn: () => getSite(siteId, { as_of: active!.t2 }),
    enabled: !!active,
    refetchInterval: false,
  })
  const readiness1 = useQuery({
    queryKey: ['readiness', { as_of: active?.t1 }],
    queryFn: () => getReadiness({ as_of: active!.t1 }),
    enabled: !!active,
    refetchInterval: false,
  })
  const readiness2 = useQuery({
    queryKey: ['readiness', { as_of: active?.t2 }],
    queryFn: () => getReadiness({ as_of: active!.t2 }),
    enabled: !!active,
    refetchInterval: false,
  })

  const diff = useMemo(() => {
    if (!site1.data || !site2.data || !readiness1.data || !readiness2.data) return null
    const r1 = readiness1.data.find((r) => r.site_id === siteId) ?? null
    const r2 = readiness2.data.find((r) => r.site_id === siteId) ?? null
    const before = { ...stripIgnoredSiteFields(site1.data), ...readinessSnapshot(r1) }
    const after  = { ...stripIgnoredSiteFields(site2.data), ...readinessSnapshot(r2) }
    return diffSnapshots(before, after)
  }, [site1.data, site2.data, readiness1.data, readiness2.data, siteId])

  const validationError = useMemo(() => {
    if (!t1Input || !t2Input) return 'Pick a timestamp for both T1 and T2.'
    const t1Ms = new Date(t1Input).getTime()
    const t2Ms = new Date(t2Input).getTime()
    if (Number.isNaN(t1Ms) || Number.isNaN(t2Ms)) return 'One of the timestamps is invalid.'
    if (t1Ms >= t2Ms) return 'T1 must be strictly before T2.'
    return null
  }, [t1Input, t2Input])

  function handleCompare() {
    if (validationError) return
    setActive({ t1: fromDatetimeLocal(t1Input), t2: fromDatetimeLocal(t2Input) })
  }

  const isLoading =
    !!active && (site1.isPending || site2.isPending || readiness1.isPending || readiness2.isPending)
  const fetchError = active
    ? site1.error ?? site2.error ?? readiness1.error ?? readiness2.error
    : null

  return (
    <div className="compare-tab">
      <div className="compare-tab-controls">
        <label className="compare-tab-field">
          <span className="bp6-text-muted">T1 (earlier)</span>
          <input
            type="datetime-local"
            className="bp6-input"
            value={t1Input}
            onChange={(e) => handleT1Change(e.target.value)}
            aria-label="Compare T1 timestamp"
          />
        </label>
        <label className="compare-tab-field">
          <span className="bp6-text-muted">T2 (later)</span>
          <input
            type="datetime-local"
            className="bp6-input"
            value={t2Input}
            onChange={(e) => handleT2Change(e.target.value)}
            aria-label="Compare T2 timestamp"
          />
        </label>
        <Button
          intent="primary"
          icon="comparison"
          text="Compare"
          onClick={handleCompare}
          disabled={!!validationError}
          title={validationError ?? undefined}
        />
      </div>

      {validationError && (
        <Callout intent="warning" className="compare-tab-validation">
          {validationError}
        </Callout>
      )}

      {isLoading && (
        <div className="compare-tab-loading">
          <Spinner size={20} />
        </div>
      )}

      {fetchError && !isLoading && (
        <Callout intent="danger" title="Could not load both snapshots">
          {fetchError.message}
        </Callout>
      )}

      {!isLoading && !fetchError && !active && (
        <Callout intent="none" icon="info-sign" className="compare-tab-hint">
          Pick two timestamps and press Compare to see how this site's state and readiness changed between them.
        </Callout>
      )}

      {!isLoading && !fetchError && diff && active && (
        <SnapshotDiffView
          diff={diff}
          emptyTitle="No site changes"
          emptyDescription="Checked: status, flag, geofence, AO assignment, readiness score, task counts. Coordinates and mechanical timestamps are excluded."
        />
      )}
    </div>
  )
}
