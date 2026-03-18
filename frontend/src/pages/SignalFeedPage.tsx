import { useState } from 'react'
import {
  Button,
  Callout,
  Classes,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
  HTMLSelect,
  HTMLTable,
  InputGroup,
  NonIdealState,
  Tag,
} from '@blueprintjs/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSignals } from '../hooks/useSignals'
import { injectSignal } from '../api/signals'
import type { SignalSource, SignalType } from '../api/types'

const SKELETON_ROWS = 8

const SOURCE_LABELS: Record<string, string> = {
  opensky:       'OpenSky',
  ais:           'AIS',
  usgs_seismic:  'USGS Seismic',
  gpsjam:        'GPSJam',
  firms_wildfire:'FIRMS Wildfire',
  manual:        'Manual',
}

const TYPE_LABELS: Record<string, string> = {
  aircraft_position: 'Aircraft',
  vessel_position:   'Vessel',
  seismic_event:     'Seismic',
  gps_jamming:       'GPS Jam',
  wildfire:          'Wildfire',
  manual:            'Manual',
}

const TYPE_INTENTS: Record<string, 'primary' | 'warning' | 'danger' | 'none' | 'success'> = {
  aircraft_position: 'primary',
  vessel_position:   'primary',
  seismic_event:     'danger',
  gps_jamming:       'warning',
  wildfire:          'danger',
  manual:            'none',
}

function formatRelativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

const SIGNAL_TYPES: SignalType[] = [
  'aircraft_position', 'vessel_position', 'seismic_event', 'gps_jamming', 'wildfire', 'manual',
]

function InjectDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [signalType, setSignalType] = useState<SignalType>('manual')
  const [lat, setLat]               = useState('')
  const [lng, setLng]               = useState('')
  const [magnitude, setMagnitude]   = useState('')
  const [note, setNote]             = useState('')
  const [error, setError]           = useState<string | null>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: injectSignal,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signals'] })
      queryClient.invalidateQueries({ queryKey: ['signal_rule_matches'] })
      onClose()
      setLat(''); setLng(''); setMagnitude(''); setNote(''); setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit() {
    const latN = parseFloat(lat)
    const lngN = parseFloat(lng)
    if (isNaN(latN) || latN < -90 || latN > 90) { setError('Latitude must be between -90 and 90'); return }
    if (isNaN(lngN) || lngN < -180 || lngN > 180) { setError('Longitude must be between -180 and 180'); return }
    setError(null)
    mutate({
      signal_type: signalType,
      lat: latN,
      lng: lngN,
      magnitude: magnitude ? parseFloat(magnitude) : null,
      note: note || null,
    })
  }

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Inject Signal" style={{ width: 420 }}>
      <DialogBody>
        {error && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{error}</Callout>}
        <FormGroup label="Signal Type" labelFor="inject-type">
          <HTMLSelect
            id="inject-type"
            value={signalType}
            onChange={e => setSignalType(e.target.value as SignalType)}
            fill
          >
            {SIGNAL_TYPES.map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
            ))}
          </HTMLSelect>
        </FormGroup>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormGroup label="Latitude" labelFor="inject-lat" helperText="-90 to 90">
            <InputGroup
              id="inject-lat"
              placeholder="e.g. 33.5"
              value={lat}
              onChange={e => setLat(e.target.value)}
            />
          </FormGroup>
          <FormGroup label="Longitude" labelFor="inject-lng" helperText="-180 to 180">
            <InputGroup
              id="inject-lng"
              placeholder="e.g. 44.3"
              value={lng}
              onChange={e => setLng(e.target.value)}
            />
          </FormGroup>
        </div>
        <FormGroup label="Magnitude" labelFor="inject-mag" helperText="Optional — for seismic / wildfire / GPS jamming">
          <InputGroup
            id="inject-mag"
            placeholder="e.g. 4.5"
            value={magnitude}
            onChange={e => setMagnitude(e.target.value)}
          />
        </FormGroup>
        <FormGroup label="Note" labelFor="inject-note" helperText="Optional — stored in raw_payload">
          <InputGroup
            id="inject-note"
            placeholder="e.g. Demo injection for briefing"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </FormGroup>
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button intent="primary" onClick={handleSubmit} loading={isPending}>
              Inject &amp; Evaluate Rules
            </Button>
          </>
        }
      />
    </Dialog>
  )
}

export default function SignalFeedPage() {
  const [sourceFilter, setSourceFilter] = useState<SignalSource | ''>('')
  const [typeFilter,   setTypeFilter]   = useState<SignalType | ''>('')
  const [injectOpen,   setInjectOpen]   = useState(false)

  const { data, error, isPending } = useSignals({
    per_page: 100,
    ...(sourceFilter ? { source: sourceFilter } : {}),
    ...(typeFilter   ? { signal_type: typeFilter } : {}),
  })

  if (error) {
    return (
      <div className="page-content">
        <Callout intent="danger" title="Failed to load signals">
          {error.message}
        </Callout>
      </div>
    )
  }

  const signals = data?.data ?? []
  const total   = data?.meta?.total ?? signals.length

  return (
    <div className="page-content">
      <InjectDialog isOpen={injectOpen} onClose={() => setInjectOpen(false)} />
      <div className="page-header">
        <h2 className="bp6-heading">Signal Feed</h2>
        <span className="bp6-text-muted">
          {isPending
            ? <span className={Classes.SKELETON} style={{ width: 64, display: 'inline-block' }}>&nbsp;</span>
            : `${total} signals`}
        </span>
        <Button
          icon="lightning"
          intent="warning"
          small
          style={{ marginLeft: 'auto' }}
          onClick={() => setInjectOpen(true)}
        >
          Inject Signal
        </Button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <HTMLSelect
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value as SignalSource | '')}
          style={{ minWidth: 140 }}
        >
          <option value="">All sources</option>
          {Object.entries(SOURCE_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </HTMLSelect>

        <HTMLSelect
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as SignalType | '')}
          style={{ minWidth: 140 }}
        >
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </HTMLSelect>
      </div>

      {!isPending && signals.length === 0 && (
        <NonIdealState
          icon="feed"
          title="No signals yet"
          description="Signal ingestion starts automatically when the server boots. Aircraft (OpenSky) and seismic (USGS) data arrive within 60–300 seconds. Vessel (AIS Hub) and wildfire (NASA FIRMS) feeds require API keys in .env."
        />
      )}

      {(isPending || signals.length > 0) && (
        <HTMLTable className="data-table" striped interactive>
          <thead>
            <tr>
              <th>Source</th>
              <th>Type</th>
              <th>External ID</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Speed / Mag</th>
              <th>Alt / Depth</th>
              <th>Occurred</th>
            </tr>
          </thead>
          <tbody>
            {isPending
              ? Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                  <tr key={i}>
                    <td><span className={Classes.SKELETON} style={{ width: 72, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 80, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ display: 'block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 64, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 64, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 48, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 56, display: 'inline-block' }}>&nbsp;</span></td>
                    <td><span className={Classes.SKELETON} style={{ width: 72, display: 'inline-block' }}>&nbsp;</span></td>
                  </tr>
                ))
              : signals.map(signal => {
                  // Column 6: speed (m/s) for moving objects; magnitude for seismic/wildfire
                  const isSeismic  = signal.signal_type === 'seismic_event'
                  const isWildfire = signal.signal_type === 'wildfire'
                  const speedOrMag = (isSeismic || isWildfire)
                    ? (signal.magnitude != null ? `M ${Number(signal.magnitude).toFixed(1)}` : '—')
                    : (signal.speed      != null ? `${Number(signal.speed).toFixed(1)} m/s`  : '—')

                  // Column 7: altitude for aircraft; depth (km) for seismic
                  const altOrDepth = isSeismic
                    ? (signal.raw_payload?.depth_km != null
                        ? `${Number(signal.raw_payload.depth_km).toFixed(0)} km`
                        : '—')
                    : (signal.altitude != null
                        ? `${Number(signal.altitude).toFixed(0)} m`
                        : '—')

                  return (
                    <tr key={signal.id}>
                      <td>
                        <Tag minimal intent="none">
                          {SOURCE_LABELS[signal.source] ?? signal.source}
                        </Tag>
                      </td>
                      <td>
                        <Tag minimal intent={TYPE_INTENTS[signal.signal_type] ?? 'none'}>
                          {TYPE_LABELS[signal.signal_type] ?? signal.signal_type}
                        </Tag>
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>{signal.external_id}</td>
                      <td className="mono">{Number(signal.lat).toFixed(4)}</td>
                      <td className="mono">{Number(signal.lng).toFixed(4)}</td>
                      <td className="mono">{speedOrMag}</td>
                      <td className="mono">{altOrDepth}</td>
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                        {formatRelativeTime(signal.occurred_at)}
                      </td>
                    </tr>
                  )
                })
            }
          </tbody>
        </HTMLTable>
      )}
    </div>
  )
}
