import { useMemo, useState } from 'react'
import { Button, Callout, Spinner } from '@blueprintjs/core'
import { useIncident } from '../../hooks/useIncidents'
import type { Incident } from '../../api/incidents'
import { diffSnapshots } from '../../utils/diffSnapshots'
import SnapshotDiffView from '../SnapshotDiffView'

// Fields that are either computed at response time (collection counts built from
// relations), nested collections that would diff poorly as opaque JSON blobs, or
// purely mechanical (updated_at, id). A field-level diff over these would add noise
// without telling the operator anything they can act on — the point of Slice 4b
// is to surface the incident's own state delta, not mechanical churn.
const IGNORED_INCIDENT_FIELDS = new Set<keyof Incident | string>([
  'id',
  'updated_at',
  'alerts',
  'tasks',
])

function stripIgnored(incident: Incident): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(incident)) {
    if (IGNORED_INCIDENT_FIELDS.has(key)) continue
    out[key] = value
  }
  return out
}

function toDatetimeLocal(iso: string): string {
  // `datetime-local` needs the form YYYY-MM-DDTHH:mm in the browser's local zone.
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

function fromDatetimeLocal(value: string): string {
  // datetime-local is interpreted in the local zone; convert to an ISO instant for
  // the API, which expects UTC.
  return new Date(value).toISOString()
}

interface IncidentCompareTabProps {
  incidentId: string
  openedAt: string
  latestAt: string
}

export default function IncidentCompareTab({ incidentId, openedAt, latestAt }: IncidentCompareTabProps) {
  // Sensible defaults: T1 at open, T2 at latest. The operator can narrow or
  // shift the window from there.
  const [t1Input, setT1Input] = useState(() => toDatetimeLocal(openedAt))
  const [t2Input, setT2Input] = useState(() => toDatetimeLocal(latestAt))
  const [active, setActive] = useState<{ t1: string; t2: string } | null>(null)

  const t1Query = useIncident(
    active ? incidentId : undefined,
    active ? { as_of: active.t1 } : undefined,
    { enabled: !!active, refetchInterval: false },
  )
  const t2Query = useIncident(
    active ? incidentId : undefined,
    active ? { as_of: active.t2 } : undefined,
    { enabled: !!active, refetchInterval: false },
  )

  const diff = useMemo(() => {
    if (!t1Query.data || !t2Query.data) return null
    return diffSnapshots(stripIgnored(t1Query.data), stripIgnored(t2Query.data))
  }, [t1Query.data, t2Query.data])

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

  const isLoading = !!active && (t1Query.isPending || t2Query.isPending)
  const fetchError = active ? t1Query.error ?? t2Query.error : null

  return (
    <div className="compare-tab">
      <div className="compare-tab-controls">
        <label className="compare-tab-field">
          <span className="bp6-text-muted">T1 (earlier)</span>
          <input
            type="datetime-local"
            className="bp6-input"
            value={t1Input}
            onChange={(e) => setT1Input(e.target.value)}
            aria-label="Compare T1 timestamp"
          />
        </label>
        <label className="compare-tab-field">
          <span className="bp6-text-muted">T2 (later)</span>
          <input
            type="datetime-local"
            className="bp6-input"
            value={t2Input}
            onChange={(e) => setT2Input(e.target.value)}
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
          Pick two timestamps and press Compare to see what changed on this incident between them.
        </Callout>
      )}

      {!isLoading && !fetchError && diff && active && (
        <SnapshotDiffView
          diff={diff}
          emptyTitle="No incident changes"
          emptyDescription="None of this incident's tracked fields changed between T1 and T2."
        />
      )}
    </div>
  )
}
