import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Button,
  Callout,
  Classes,
  HTMLSelect,
  InputGroup,
  NonIdealState,
  Spinner,
  Tag,
} from '@blueprintjs/core'
import { useVirtualizer } from '@tanstack/react-virtual'
import ExportButton from '../components/ExportButton'
import InjectDialog from '../components/signals/InjectDialog'
import { useSignalsInfinite, useSignalsLive } from '../hooks/useSignals'
import { useReferenceTimeMs } from '../hooks/useReferenceTimeMs'
import { useReplayParams } from '../hooks/useReplayParams'
import { getAiFilter } from '../api/ai'
import { useRole } from '../hooks/useRole'
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
  gdacs:          'GDACS',
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
  disaster_alert:    'Disaster',
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
  disaster_alert:    'danger',
  manual:            'none',
  ais_gap:           'warning',
}

const LIVE_FEED_LIMITS: Partial<Record<SignalType, number>> = {
  aircraft_position: 300,
  vessel_position: 150,
  seismic_event: 150,
  gps_jamming: 150,
  wildfire: 150,
  conflict_event: 150,
  disaster_alert: 150,
  manual: 75,
  ais_gap: 75,
}

// Fixed row height in pixels — required by the virtualizer.
// All rows render a single line of content so this is safe.
const ROW_HEIGHT = 40

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(iso: string, referenceTimeMs: number): string {
  const diff = Math.max(0, (referenceTimeMs - new Date(iso).getTime()) / 1000)
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
  const isDisaster = signal.signal_type === 'disaster_alert'
  if (isDisaster)
    return signal.magnitude != null ? `Score ${Number(signal.magnitude).toFixed(1)}` : '—'
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
// SignalFeedPage
// ---------------------------------------------------------------------------

export default function SignalFeedPage() {
  const { isCommander } = useRole()
  const { asOf, isReplaying, signalQueryParams } = useReplayParams()
  const referenceTimeMs = useReferenceTimeMs(asOf)

  const [sourceFilter, setSourceFilter] = useState<SignalSource | ''>('')
  const [typeFilter,   setTypeFilter]   = useState<SignalType   | ''>('')
  const [injectOpen,   setInjectOpen]   = useState(false)

  // AI natural-language filter state — rendered only for commanders (backend enforces via require_commander!)
  const [nlQuery,   setNlQuery]   = useState('')
  const [nlLoading, setNlLoading] = useState(false)
  const [nlError,   setNlError]   = useState<string | null>(null)
  const [nlApplied, setNlApplied] = useState(false)
  const [nlSiteId,  setNlSiteId]  = useState<string | null>(null)
  const [nlFrom,    setNlFrom]    = useState<string | null>(null)
  const [nlTo,      setNlTo]      = useState<string | null>(null)
  const nlInputRef = useRef<HTMLInputElement>(null)

  function handleNlSearch() {
    const q = nlQuery.trim()
    if (!q) return
    setNlLoading(true)
    setNlError(null)
    getAiFilter(q, 'signals')
      .then(({ data }) => {
        const { filters } = data
        if (filters.signal_type) setTypeFilter(filters.signal_type)
        if (filters.source)      setSourceFilter(filters.source)
        setNlSiteId(filters.site_id)
        setNlFrom(filters.from)
        setNlTo(filters.to)
        setNlApplied(true)
      })
      .catch((err: unknown) => {
        setNlError(err instanceof Error ? err.message : 'AI filter failed')
      })
      .finally(() => setNlLoading(false))
  }

  function clearNlFilter() {
    setNlQuery('')
    setNlApplied(false)
    setNlError(null)
    setNlSiteId(null)
    setNlFrom(null)
    setNlTo(null)
    setTypeFilter('')
    setSourceFilter('')
    nlInputRef.current?.focus()
  }

  const filterParams = useMemo(() => ({
    ...signalQueryParams,
    ...(sourceFilter ? { source:      sourceFilter }    : {}),
    ...(typeFilter   ? { signal_type: typeFilter }      : {}),
    ...(nlSiteId     ? { site_id:     nlSiteId }        : {}),
    ...(nlFrom       ? { from:        nlFrom }          : {}),
    ...(nlTo         ? { to:          nlTo }            : {}),
  }), [nlFrom, nlSiteId, nlTo, signalQueryParams, sourceFilter, typeFilter])

  const isUnfilteredMode = useMemo(
    () => !sourceFilter && !typeFilter && !nlSiteId && !nlFrom && !nlTo,
    [nlFrom, nlSiteId, nlTo, sourceFilter, typeFilter],
  )
  const useStreamFeed = isUnfilteredMode && !isReplaying

  const defaultSignals = useSignalsLive({
    enabled: useStreamFeed,
    asOf,
    replayParams: signalQueryParams,
    limits: LIVE_FEED_LIMITS,
  })

  const {
    data,
    error,
    isPending,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useSignalsInfinite(filterParams, {
    enabled: !useStreamFeed,
    refetchInterval: isReplaying ? false : 30_000,
  })

  // Flatten all pages into a single array for the virtualizer.
  const allSignals: Signal[] = useMemo(
    () => useStreamFeed ? defaultSignals.signals : (data?.pages.flatMap(p => p.data) ?? []),
    [data, defaultSignals.signals, useStreamFeed],
  )

  const total = useStreamFeed ? allSignals.length : (data?.pages[0]?.meta.total ?? 0)
  const activeSignalsPending = useStreamFeed ? defaultSignals.isPending : isPending
  const showSkeletonTable = activeSignalsPending && allSignals.length === 0
  const showEmptyState = !defaultSignals.error && !activeSignalsPending && allSignals.length === 0

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
    if (!useStreamFeed && hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, useStreamFeed])

  useEffect(() => {
    if (!lastVirtualItem) return
    if (lastVirtualItem.index >= lastItemIndex - 10) {
      fetchMore()
    }
  }, [lastVirtualItem, lastItemIndex, fetchMore])

  if (!useStreamFeed && error) {
    return (
      <div className="page-content">
        <Callout intent="danger" title="Failed to load signals">{(error as Error).message}</Callout>
      </div>
    )
  }

  return (
    <div className="page-content signal-feed-page">
      {!isReplaying && <InjectDialog isOpen={injectOpen} onClose={() => setInjectOpen(false)} />}

      {/* Header */}
      <div className="page-header">
        <h2 className="bp6-heading">Signal Feed</h2>
        <span className="bp6-text-muted">
          {useStreamFeed
            ? defaultSignals.isPending
              ? <span className={Classes.SKELETON} style={{ width: 64, display: 'inline-block' }}>&nbsp;</span>
              : `${allSignals.length.toLocaleString()} recent live signals`
            : isPending
            ? <span className={Classes.SKELETON} style={{ width: 64, display: 'inline-block' }}>&nbsp;</span>
            : allSignals.length > 0
              ? `${allSignals.length.toLocaleString()} of ${total.toLocaleString()} loaded`
              : `${total} signals`}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <ExportButton
            entityType="signals"
            filters={{
              source: sourceFilter || undefined,
              signal_type: typeFilter || undefined,
              site_id: nlSiteId || undefined,
              from: nlFrom || undefined,
              to: nlTo || undefined,
            }}
          />
          {isCommander && !isReplaying && (
            <Button
              icon="lightning"
              intent="warning"
              small
              onClick={() => setInjectOpen(true)}
            >
              Inject Signal
            </Button>
          )}
        </span>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <HTMLSelect
          value={sourceFilter}
          onChange={e => { setSourceFilter(e.target.value as SignalSource | ''); setNlApplied(false); setNlError(null); setNlSiteId(null); setNlFrom(null); setNlTo(null) }}
          style={{ minWidth: 140 }}
        >
          <option value="">All sources</option>
          {Object.entries(SOURCE_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </HTMLSelect>

        <HTMLSelect
          value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value as SignalType | ''); setNlApplied(false); setNlError(null); setNlSiteId(null); setNlFrom(null); setNlTo(null) }}
          style={{ minWidth: 140 }}
        >
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </HTMLSelect>
      </div>

      {/* AI natural-language filter — commanders only (backend also enforces via require_commander!) */}
      {isCommander && <div className="nl-filter-row">
        <InputGroup
          inputRef={nlInputRef}
          placeholder="e.g. show GPS jamming signals from last 6 hours"
          value={nlQuery}
          onChange={e => setNlQuery(e.currentTarget.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleNlSearch() }}
          rightElement={
            nlApplied
              ? <Button minimal icon="cross" onClick={clearNlFilter} title="Clear AI filter" />
              : <Button minimal icon="search" loading={nlLoading} onClick={handleNlSearch} title="Apply AI filter" />
          }
          disabled={nlLoading}
        />
        {nlApplied && (
          <Tag intent="primary" minimal icon="predictive-analysis">AI filter applied</Tag>
        )}
        {nlError && (
          <Tag intent="danger" minimal icon="error">{nlError}</Tag>
        )}
      </div>}

      {useStreamFeed && defaultSignals.error && (
        <Callout intent="warning" icon="warning-sign" style={{ marginBottom: 8 }}>
          Live signal baseline sync is incomplete. Recent signals may be missing while the feed retries automatically.
        </Callout>
      )}

      {/* Empty state */}
      {showEmptyState && (
        <NonIdealState
          icon="feed"
          title="No signals yet"
          description={
            useStreamFeed
              ? 'The live stream is connected but no recent signals are in the current in-memory window yet.'
              : 'Signal ingestion starts automatically when the server boots. Aircraft (OpenSky) and seismic (USGS) data arrive within 60–300 seconds. Vessel (AIS Hub) and wildfire (NASA FIRMS) feeds require API keys in .env.'
          }
        />
      )}

      {/* Virtual table */}
      {(showSkeletonTable || allSignals.length > 0) && (
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
            {showSkeletonTable ? (
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
                            {formatRelativeTime(signal.occurred_at, referenceTimeMs)}
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
                {useStreamFeed
                  ? `${allSignals.length.toLocaleString()} recent live signals in stream window`
                  : hasNextPage
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
