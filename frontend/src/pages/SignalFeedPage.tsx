import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Button,
  Callout,
  Classes,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
  HTMLSelect,
  InputGroup,
  NonIdealState,
  Spinner,
  Tag,
} from '@blueprintjs/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useSignalsInfinite } from '../hooks/useSignals'
import { injectSignal } from '../api/signals'
import type { Signal, SignalSource, SignalType } from '../api/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<string, string> = {
  opensky:        'OpenSky',
  ais:            'AIS',
  usgs_seismic:   'USGS Seismic',
  gpsjam:         'GPSJam',
  firms_wildfire: 'FIRMS Wildfire',
  acled:          'ACLED',
  manual:         'Manual',
  derived:        'Derived',
}

const TYPE_LABELS: Record<string, string> = {
  aircraft_position: 'Aircraft',
  vessel_position:   'Vessel',
  seismic_event:     'Seismic',
  gps_jamming:       'GPS Jam',
  wildfire:          'Wildfire',
  conflict_event:    'Conflict',
  manual:            'Manual',
  ais_gap:           'AIS Gap',
}

const TYPE_INTENTS: Record<string, 'primary' | 'warning' | 'danger' | 'none' | 'success'> = {
  aircraft_position: 'primary',
  vessel_position:   'primary',
  seismic_event:     'danger',
  gps_jamming:       'warning',
  wildfire:          'danger',
  conflict_event:    'danger',
  manual:            'none',
  ais_gap:           'warning',
}

const SIGNAL_TYPES: SignalType[] = [
  'aircraft_position', 'vessel_position', 'seismic_event',
  'gps_jamming', 'wildfire', 'conflict_event', 'manual',
]

// Fixed row height in pixels — required by the virtualizer.
// All rows render a single line of content so this is safe.
const ROW_HEIGHT = 40

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60)   return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function speedOrMag(signal: Signal): string {
  const isSeismic  = signal.signal_type === 'seismic_event'
  const isWildfire = signal.signal_type === 'wildfire'
  const isConflict = signal.signal_type === 'conflict_event'
  if (isSeismic || isWildfire)
    return signal.magnitude != null ? `M ${Number(signal.magnitude).toFixed(1)}` : '—'
  if (isConflict)
    return signal.magnitude != null ? `${Math.round(Number(signal.magnitude))} fatalities` : '—'
  return signal.speed != null ? `${Number(signal.speed).toFixed(1)} m/s` : '—'
}

function altOrDepth(signal: Signal): string {
  if (signal.signal_type === 'seismic_event')
    return signal.raw_payload?.depth_km != null
      ? `${Number(signal.raw_payload.depth_km).toFixed(0)} km`
      : '—'
  return signal.altitude != null ? `${Number(signal.altitude).toFixed(0)} m` : '—'
}

// ---------------------------------------------------------------------------
// InjectDialog — unchanged from previous version
// ---------------------------------------------------------------------------

function InjectDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [signalType, setSignalType] = useState<SignalType>('manual')
  const [lat,        setLat]        = useState('')
  const [lng,        setLng]        = useState('')
  const [magnitude,  setMagnitude]  = useState('')
  const [note,       setNote]       = useState('')
  const [error,      setError]      = useState<string | null>(null)

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
    if (isNaN(latN) || latN < -90  || latN > 90)  { setError('Latitude must be between -90 and 90');   return }
    if (isNaN(lngN) || lngN < -180 || lngN > 180) { setError('Longitude must be between -180 and 180'); return }
    setError(null)
    mutate({ signal_type: signalType, lat: latN, lng: lngN,
             magnitude: magnitude ? parseFloat(magnitude) : null,
             note: note || null })
  }

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Inject Signal" style={{ width: 420 }}>
      <DialogBody>
        {error && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{error}</Callout>}
        <FormGroup label="Signal Type" labelFor="inject-type">
          <HTMLSelect id="inject-type" value={signalType} fill
            onChange={e => setSignalType(e.target.value as SignalType)}>
            {SIGNAL_TYPES.map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
            ))}
          </HTMLSelect>
        </FormGroup>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormGroup label="Latitude" labelFor="inject-lat" helperText="-90 to 90">
            <InputGroup id="inject-lat" placeholder="e.g. 33.5" value={lat}
              onChange={e => setLat(e.target.value)} />
          </FormGroup>
          <FormGroup label="Longitude" labelFor="inject-lng" helperText="-180 to 180">
            <InputGroup id="inject-lng" placeholder="e.g. 44.3" value={lng}
              onChange={e => setLng(e.target.value)} />
          </FormGroup>
        </div>
        <FormGroup label="Magnitude" labelFor="inject-mag" helperText="Optional — seismic / wildfire / GPS jamming">
          <InputGroup id="inject-mag" placeholder="e.g. 4.5" value={magnitude}
            onChange={e => setMagnitude(e.target.value)} />
        </FormGroup>
        <FormGroup label="Note" labelFor="inject-note" helperText="Optional — stored in raw_payload">
          <InputGroup id="inject-note" placeholder="e.g. Demo injection for briefing"
            value={note} onChange={e => setNote(e.target.value)} />
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

// ---------------------------------------------------------------------------
// SignalFeedPage
// ---------------------------------------------------------------------------

export default function SignalFeedPage() {
  const [sourceFilter, setSourceFilter] = useState<SignalSource | ''>('')
  const [typeFilter,   setTypeFilter]   = useState<SignalType   | ''>('')
  const [injectOpen,   setInjectOpen]   = useState(false)

  const filterParams = useMemo(() => ({
    ...(sourceFilter ? { source: sourceFilter } : {}),
    ...(typeFilter   ? { signal_type: typeFilter } : {}),
  }), [sourceFilter, typeFilter])

  const {
    data,
    error,
    isPending,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useSignalsInfinite(filterParams)

  // Flatten all pages into a single array for the virtualizer.
  const allSignals: Signal[] = useMemo(
    () => data?.pages.flatMap(p => p.data) ?? [],
    [data]
  )

  const total = data?.pages[0]?.meta.total ?? 0

  // ── Virtualizer setup ────────────────────────────────────────────────────
  // The scroll container is a fixed-height div wrapping the table body.
  const scrollRef = useRef<HTMLDivElement>(null)

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count:            allSignals.length,
    getScrollElement: () => scrollRef.current,
    estimateSize:     () => ROW_HEIGHT,
    overscan:         10, // render 10 extra rows above/below viewport
  })

  const virtualItems = virtualizer.getVirtualItems()
  const totalHeight  = virtualizer.getTotalSize()

  // ── Infinite scroll trigger ───────────────────────────────────────────────
  // When the last virtual item reaches the viewport, fetch the next page.
  const lastItemIndex = allSignals.length - 1
  const lastVirtualItem = virtualItems[virtualItems.length - 1]

  const fetchMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  useEffect(() => {
    if (!lastVirtualItem) return
    if (lastVirtualItem.index >= lastItemIndex - 10) {
      fetchMore()
    }
  }, [lastVirtualItem, lastItemIndex, fetchMore])

  if (error) {
    return (
      <div className="page-content">
        <Callout intent="danger" title="Failed to load signals">{(error as Error).message}</Callout>
      </div>
    )
  }

  return (
    <div className="page-content signal-feed-page">
      <InjectDialog isOpen={injectOpen} onClose={() => setInjectOpen(false)} />

      {/* Header */}
      <div className="page-header">
        <h2 className="bp6-heading">Signal Feed</h2>
        <span className="bp6-text-muted">
          {isPending
            ? <span className={Classes.SKELETON} style={{ width: 64, display: 'inline-block' }}>&nbsp;</span>
            : allSignals.length > 0
              ? `${allSignals.length.toLocaleString()} of ${total.toLocaleString()} loaded`
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

      {/* Empty state */}
      {!isPending && allSignals.length === 0 && (
        <NonIdealState
          icon="feed"
          title="No signals yet"
          description="Signal ingestion starts automatically when the server boots. Aircraft (OpenSky) and seismic (USGS) data arrive within 60–300 seconds. Vessel (AIS Hub) and wildfire (NASA FIRMS) feeds require API keys in .env."
        />
      )}

      {/* Virtual table */}
      {(isPending || allSignals.length > 0) && (
        <div className="signal-feed-table-wrap">
          {/* Sticky header — sits above the scroll container */}
          <table className="data-table signal-feed-table" style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              <col style={{ width: 110 }} />
              <col style={{ width: 96  }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 88  }} />
              <col style={{ width: 88  }} />
              <col style={{ width: 88  }} />
              <col style={{ width: 80  }} />
              <col style={{ width: 88  }} />
            </colgroup>
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
          </table>

          {/* Scrollable virtual body */}
          <div
            ref={scrollRef}
            className="signal-feed-scroll"
            style={{ height: 560, overflow: 'auto' }}
          >
            {isPending ? (
              <table className="data-table signal-feed-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                  <col style={{ width: 110 }} />
                  <col style={{ width: 96  }} />
                  <col style={{ width: 180 }} />
                  <col style={{ width: 88  }} />
                  <col style={{ width: 88  }} />
                  <col style={{ width: 88  }} />
                  <col style={{ width: 80  }} />
                  <col style={{ width: 88  }} />
                </colgroup>
                <tbody>
                  {Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} style={{ height: ROW_HEIGHT }}>
                      <td><span className={Classes.SKELETON} style={{ width: 72, display: 'inline-block' }}>&nbsp;</span></td>
                      <td><span className={Classes.SKELETON} style={{ width: 64, display: 'inline-block' }}>&nbsp;</span></td>
                      <td><span className={Classes.SKELETON} style={{ display: 'block' }}>&nbsp;</span></td>
                      <td><span className={Classes.SKELETON} style={{ width: 60, display: 'inline-block' }}>&nbsp;</span></td>
                      <td><span className={Classes.SKELETON} style={{ width: 60, display: 'inline-block' }}>&nbsp;</span></td>
                      <td><span className={Classes.SKELETON} style={{ width: 48, display: 'inline-block' }}>&nbsp;</span></td>
                      <td><span className={Classes.SKELETON} style={{ width: 48, display: 'inline-block' }}>&nbsp;</span></td>
                      <td><span className={Classes.SKELETON} style={{ width: 56, display: 'inline-block' }}>&nbsp;</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              // The outer div is totalHeight tall — the virtualizer creates the
              // illusion of a full list by positioning a small subset of rows.
              <div style={{ height: totalHeight, position: 'relative' }}>
                <table
                  className="data-table signal-feed-table"
                  style={{
                    tableLayout: 'fixed',
                    width: '100%',
                    position: 'absolute',
                    top: virtualItems[0]?.start ?? 0,
                  }}
                >
                  <colgroup>
                    <col style={{ width: 110 }} />
                    <col style={{ width: 96  }} />
                    <col style={{ width: 180 }} />
                    <col style={{ width: 88  }} />
                    <col style={{ width: 88  }} />
                    <col style={{ width: 88  }} />
                    <col style={{ width: 80  }} />
                    <col style={{ width: 88  }} />
                  </colgroup>
                  <tbody>
                    {virtualItems.map(vItem => {
                      const signal = allSignals[vItem.index]
                      return (
                        <tr
                          key={signal.id}
                          data-index={vItem.index}
                          ref={virtualizer.measureElement}
                          style={{ height: ROW_HEIGHT }}
                          className={vItem.index % 2 === 0 ? 'row-even' : 'row-odd'}
                        >
                          <td>
                            <Tag minimal intent="none" style={{ fontSize: 11 }}>
                              {SOURCE_LABELS[signal.source] ?? signal.source}
                            </Tag>
                          </td>
                          <td>
                            <Tag minimal intent={TYPE_INTENTS[signal.signal_type] ?? 'none'} style={{ fontSize: 11 }}>
                              {TYPE_LABELS[signal.signal_type] ?? signal.signal_type}
                            </Tag>
                          </td>
                          <td className="mono" style={{ fontSize: 11 }}>{signal.external_id}</td>
                          <td className="mono">{Number(signal.lat).toFixed(4)}</td>
                          <td className="mono">{Number(signal.lng).toFixed(4)}</td>
                          <td className="mono">{speedOrMag(signal)}</td>
                          <td className="mono">{altOrDepth(signal)}</td>
                          <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                            {formatRelativeTime(signal.occurred_at)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Footer: loading indicator + count */}
          <div className="signal-feed-footer">
            {isFetchingNextPage && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Spinner size={12} />
                <span className="bp6-text-muted" style={{ fontSize: 12 }}>Loading more…</span>
              </span>
            )}
            {!isFetchingNextPage && allSignals.length > 0 && (
              <span className="bp6-text-muted" style={{ fontSize: 12 }}>
                {hasNextPage
                  ? `${allSignals.length.toLocaleString()} of ${total.toLocaleString()} · scroll for more`
                  : `All ${total.toLocaleString()} signals loaded`}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
