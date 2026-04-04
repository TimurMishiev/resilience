import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Alert,
  Button,
  ButtonGroup,
  Callout,
  Checkbox,
  NonIdealState,
  Spinner,
  Tag,
  Tooltip,
} from '@blueprintjs/core'
import { useSignalRuleMatchesInfinite, useTransitionAlert, useBulkTransitionAlerts } from '../hooks/useSignalRuleMatches'
import AlertChainDrawer from '../components/AlertChainDrawer'
import { SIGNAL_ICON_NAME } from '../lib/signalIcons'
import { Icon } from '@blueprintjs/core'
import type { AlertStatus, SignalRuleMatch } from '../api/types'
import { humanize } from '../utils/humanize'
import { useReplay } from '../context/ReplayContext'
import { useRole } from '../hooks/useRole'
import { useTriageKeyboard } from '../hooks/useTriageKeyboard'

// ── Constants ────────────────────────────────────────────────────────────────

type AlertTransition = { label: string; to: AlertStatus; intent: 'primary' | 'warning' | 'none' | 'danger' }

const ALERT_TRANSITIONS: Record<AlertStatus, AlertTransition[]> = {
  unacknowledged: [
    { label: 'Acknowledge', to: 'acknowledged',  intent: 'primary' },
    { label: 'Investigate', to: 'investigating', intent: 'warning' },
    { label: 'Close',       to: 'closed',        intent: 'none'    },
  ],
  acknowledged: [
    { label: 'Investigate', to: 'investigating', intent: 'warning' },
    { label: 'Close',       to: 'closed',        intent: 'none'    },
    { label: 'Reopen',      to: 'unacknowledged', intent: 'none'   },
  ],
  investigating: [
    { label: 'Close',       to: 'closed',        intent: 'none'    },
    { label: 'Acknowledge', to: 'acknowledged',  intent: 'primary' },
  ],
  closed: [
    { label: 'Reopen',      to: 'unacknowledged', intent: 'none'   },
    { label: 'Investigate', to: 'investigating', intent: 'warning' },
  ],
}

const BULK_ACTIONS = [
  { to_status: 'acknowledged' as AlertStatus, label: 'Acknowledge', intent: 'success'  },
  { to_status: 'investigating' as AlertStatus, label: 'Investigate', intent: 'warning'  },
  { to_status: 'closed'        as AlertStatus, label: 'Close',       intent: 'danger'   },
] as const

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '',               label: 'All'           },
  { value: 'unacknowledged', label: 'Unacknowledged' },
  { value: 'acknowledged',   label: 'Acknowledged'  },
  { value: 'investigating',  label: 'Investigating' },
  { value: 'closed',         label: 'Closed'        },
]

const ALERT_STATUS_INTENT: Record<string, 'none' | 'primary' | 'warning' | 'danger' | 'success'> = {
  unacknowledged: 'danger',
  acknowledged:   'primary',
  investigating:  'warning',
  closed:         'success',
}

const ALERT_STATUS_LABEL: Record<string, string> = {
  unacknowledged: 'Unacked',
  acknowledged:   'Acked',
  investigating:  'Investigating',
  closed:         'Closed',
}

function confidenceColor(c: number): string {
  if (c >= 0.80) return '#29a634'
  if (c >= 0.65) return '#f0b726'
  if (c >= 0.40) return '#e67e22'
  return '#cd4246'
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const ALERT_ROW_ESTIMATE = 86
const ALERT_LIST_MAX_HEIGHT = 640

// ── AlertRow ─────────────────────────────────────────────────────────────────

interface AlertRowProps {
  match:        SignalRuleMatch
  canTriage:    boolean
  isChecked:    boolean
  someSelected: boolean
  onCheck:      (id: string, idx: number, shiftKey: boolean) => void
  rowIndex:     number
  onChainClick: (m: SignalRuleMatch) => void
  isReadOnly?:  boolean
  isFocused?:   boolean
}

function AlertRow({ match: m, canTriage, isChecked, someSelected, onCheck, rowIndex, onChainClick, isReadOnly = false, isFocused = false }: AlertRowProps) {
  const navigate   = useNavigate()
  const transition = useTransitionAlert()
  const actions    = (m.metadata?.actions_taken as string[] | undefined) ?? []
  const hasFlag    = actions.some(a => a.includes('flag'))
  const hasTask    = actions.some(a => a.includes('task'))
  const distKm     = m.metadata?.distance_km as number | undefined
  const intent     = hasFlag ? 'danger' : hasTask ? 'warning' : 'none'
  const status     = (m.workflow_status ?? 'unacknowledged') as AlertStatus
  const conf       = typeof m.confidence === 'number' ? m.confidence : null
  const txBtns     = ALERT_TRANSITIONS[status] ?? []

  return (
    <div className={`alert-row alert-row--${intent}${isChecked ? ' alert-row--selected' : ''}${isFocused ? ' alert-row--focused' : ''}`}>
      <div
        className="alert-row-main"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        {/* Checkbox */}
        {canTriage && (
          <div
            onClick={e => { e.stopPropagation(); onCheck(m.id, rowIndex, e.shiftKey) }}
            style={{ paddingRight: 6 }}
          >
            <Checkbox checked={isChecked} readOnly style={{ margin: 0, pointerEvents: 'none' }} />
          </div>
        )}

        {/* Main body — click navigates to site */}
        <div
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: m.site?.id ? 'pointer' : 'default',
          }}
          onClick={() => m.site?.id && navigate(`/sites/${m.site.id}`)}
        >
          <div className="alert-row-left">
            <span className="alert-signal-icon">
              {m.signal
                ? <Icon icon={SIGNAL_ICON_NAME[m.signal.signal_type] ?? 'dot'} size={14} />
                : <Icon icon="dot" size={14} />}
            </span>
            <div className="alert-body">
              <span className="alert-rule-name">
                {m.correlation_rule?.name ?? (
                  m.metadata?.geofence_breach
                    ? <Tag minimal intent="primary" icon="locate" style={{ fontSize: 10 }}>Geofence breach</Tag>
                    : 'Unknown rule'
                )}
              </span>
              {m.site && (
                <span className="alert-site bp6-text-muted">@ {m.site.name}</span>
              )}
            </div>
          </div>

          <div className="alert-row-right">
            <div className="alert-actions">
              <Tag
                minimal
                intent={ALERT_STATUS_INTENT[status] ?? 'none'}
                style={{ fontSize: 10, fontWeight: 600 }}
              >
                {ALERT_STATUS_LABEL[status] ?? status}
              </Tag>
              {conf != null && (
                <Tooltip content={`Match confidence: ${Math.round(conf * 100)}%`} placement="top">
                  <span
                    style={{ color: confidenceColor(conf), fontSize: 11, fontWeight: 600, cursor: 'default' }}
                  >
                    {Math.round(conf * 100)}%
                  </span>
                </Tooltip>
              )}
              {actions.map(a => (
                <Tag key={a} minimal intent={hasFlag ? 'danger' : 'warning'} style={{ fontSize: 10 }}>
                  {humanize(a)}
                </Tag>
              ))}
              {distKm != null && (
                <span className="bp6-text-muted" style={{ fontSize: 11 }}>{Number(distKm).toFixed(0)} km</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="alert-time bp6-text-muted">{fmtTime(m.fired_at)}</span>
              <Button
                icon="data-lineage"
                minimal small
                title="View intelligence chain"
                onClick={e => { e.stopPropagation(); onChainClick(m) }}
                style={{ minWidth: 0, minHeight: 0, opacity: 0.6 }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Per-row transition buttons — hidden when bulk selection is active or in replay */}
      {txBtns.length > 0 && canTriage && !someSelected && !isReadOnly && (
        <div
          className="alert-row-transitions"
          onClick={e => e.stopPropagation()}
          style={{ display: 'flex', gap: 4, padding: '4px 8px 6px 46px' }}
        >
          {txBtns.map(btn => (
            <Button
              key={btn.to}
              small minimal
              intent={btn.intent}
              disabled={transition.isPending}
              onClick={() => transition.mutate({ id: m.id, body: { to_status: btn.to } })}
              style={{ fontSize: 11 }}
            >
              {btn.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── AlertTriagePage ───────────────────────────────────────────────────────────

export default function AlertTriagePage() {
  const { isReplaying, asOf } = useReplay()
  const { isCommander, isOperator } = useRole()
  const canTriageAlerts = isCommander || isOperator
  const [statusFilter,  setStatusFilter]  = useState('unacknowledged')
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set())
  // Bulk close confirmation dialog state
  const [confirmClose,  setConfirmClose]  = useState(false)
  // Partial failure callout after a bulk action
  const [failCount,     setFailCount]     = useState<number | null>(null)
  const [chainMatch,    setChainMatch]    = useState<SignalRuleMatch | null>(null)
  // Index of the last row clicked — used to resolve shift-click ranges
  const lastClickedIdxRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const replayParams = isReplaying && asOf ? { as_of: asOf } : {}
  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSignalRuleMatchesInfinite({
    workflow_status: (statusFilter || undefined) as AlertStatus | undefined,
    ...replayParams,
  }, {
    refetchInterval: isReplaying ? false : 15_000,
  })

  // Flatten pages into a single array; stable reference via useMemo
  const matches = useMemo(
    () => data?.pages.flatMap(p => p.data) ?? [],
    [data?.pages],
  )
  const totalCount = data?.pages[0]?.meta.total ?? null

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ALERT_ROW_ESTIMATE,
    overscan: 8,
    getItemKey: (index) => matches[index]?.id ?? index,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const totalHeight = virtualizer.getTotalSize()
  const listHeight = Math.min(totalHeight, ALERT_LIST_MAX_HEIGHT)

  const bulkMutate = useBulkTransitionAlerts()

  // ── Selection helpers ──────────────────────────────────────────────────────

  const allSelected  = selectedIds.size > 0 && selectedIds.size === matches.length
  const someSelected = selectedIds.size > 0

  // ── Keyboard triage (j/k/a/i/c) ──────────────────────────────────────────

  const keyboardTransition = useTransitionAlert()

  const handleKeyboardTransition = useCallback((id: string, toStatus: AlertStatus) => {
    keyboardTransition.mutate({ id, body: { to_status: toStatus } })
  }, [keyboardTransition])

  const { focusedIndex } = useTriageKeyboard({
    matches,
    enabled: canTriageAlerts && !isReplaying && !someSelected,
    onTransition: handleKeyboardTransition,
    scrollToIndex: (index) => virtualizer.scrollToIndex(index, { align: 'auto' }),
  })

  const handleToggleAll = useCallback(() => {
    setSelectedIds(allSelected ? new Set() : new Set(matches.map(m => m.id)))
    lastClickedIdxRef.current = null
  }, [allSelected, matches])

  const handleRowCheck = useCallback((id: string, idx: number, shiftKey: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)

      if (shiftKey && lastClickedIdxRef.current !== null) {
        // Range select: add every id between lastClickedIdx and idx (inclusive)
        const lo = Math.min(lastClickedIdxRef.current, idx)
        const hi = Math.max(lastClickedIdxRef.current, idx)
        const wasChecked = prev.has(id)
        for (let i = lo; i <= hi; i++) {
          const rangeId = matches[i]?.id
          if (rangeId) { if (wasChecked) { next.delete(rangeId) } else { next.add(rangeId) } }
        }
      } else {
        if (next.has(id)) { next.delete(id) } else { next.add(id) }
        lastClickedIdxRef.current = idx
      }

      return next
    })
  }, [matches])

  // ── Bulk action ────────────────────────────────────────────────────────────

  function executeBulk(toStatus: AlertStatus) {
    bulkMutate.mutate(
      { ids: Array.from(selectedIds), to_status: toStatus },
      {
        onSuccess: (result) => {
          setSelectedIds(new Set())
          setConfirmClose(false)
          const failed = result.failed?.length ?? 0
          setFailCount(failed > 0 ? failed : null)
        },
      }
    )
  }

  function handleBulkClick(toStatus: AlertStatus) {
    if (toStatus === 'closed') {
      setConfirmClose(true)
    } else {
      executeBulk(toStatus)
    }
  }

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTo?.({ top: 0 })
  }, [statusFilter])

  useEffect(() => {
    virtualizer.measure()
  }, [matches.length, someSelected, virtualizer])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="page-content">
      {isReplaying && (
        <Callout intent="primary" icon="info-sign" style={{ marginBottom: 12 }}>
          Showing alerts that fired before the replay timestamp. Transition actions are disabled.
        </Callout>
      )}

      {(
        <>
      {/* ── Header ── */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 className="bp6-heading" style={{ margin: 0 }}>Alert Triage</h2>
        {totalCount !== null && (
          <Tag minimal className="bp6-text-muted" style={{ fontSize: 11 }}>
            {matches.length} / {totalCount}
          </Tag>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <ButtonGroup minimal>
            {STATUS_FILTERS.map(f => (
              <Button
                key={f.value}
                small
                active={statusFilter === f.value}
                onClick={() => { setStatusFilter(f.value); setSelectedIds(new Set()) }}
                style={{ fontSize: 12 }}
              >
                {f.label}
              </Button>
            ))}
          </ButtonGroup>
        </div>
      </div>

      {/* ── Keyboard hint ── */}
      {canTriageAlerts && !isReplaying && !someSelected && matches.length > 0 && (
        <div style={{ fontSize: 11, color: '#5c7080', marginBottom: 6 }}>
          <kbd>j</kbd>/<kbd>k</kbd> navigate &middot; <kbd>a</kbd>cknowledge &middot; <kbd>i</kbd>nvestigate &middot; <kbd>c</kbd>lose &middot; <kbd>Esc</kbd> clear
        </div>
      )}

      {/* ── Partial failure notice ── */}
      {failCount !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Callout intent="warning" compact style={{ flex: 1 }}>
            {failCount} alert{failCount !== 1 ? 's' : ''} could not be transitioned (invalid state for that action).
          </Callout>
          <Button minimal small icon="cross" onClick={() => setFailCount(null)} aria-label="Dismiss" />
        </div>
      )}

      {/* ── Bulk action toolbar — hidden in replay ── */}
      {!isReplaying && canTriageAlerts && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, minHeight: 30 }}>
        <Checkbox
          checked={allSelected}
          indeterminate={someSelected && !allSelected}
          onChange={handleToggleAll}
          style={{ margin: 0 }}
          title="Select / deselect all loaded alerts"
        />
        {someSelected ? (
          <>
            <span style={{ fontSize: 12, color: '#8a9ba8' }}>
              {selectedIds.size} of {matches.length} loaded selected
            </span>
            {BULK_ACTIONS.map(action => (
              <Button
                key={action.to_status}
                small minimal
                intent={action.intent as 'success' | 'warning' | 'danger'}
                loading={bulkMutate.isPending}
                onClick={() => handleBulkClick(action.to_status)}
                style={{ fontSize: 11 }}
              >
                {action.label}
              </Button>
            ))}
            <Button
              small minimal
              onClick={() => setSelectedIds(new Set())}
              style={{ fontSize: 11 }}
            >
              Clear
            </Button>
          </>
        ) : (
          <span style={{ fontSize: 12, color: '#5c7080' }}>
            {isLoading ? '' : `${matches.length} loaded alert${matches.length !== 1 ? 's' : ''} — select to bulk-triage`}
          </span>
        )}
      </div>}

      {/* ── Content ── */}
      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spinner size={28} />
        </div>
      )}

      {error && (
        <Callout intent="danger" compact>
          {error.message}
        </Callout>
      )}

      {!isLoading && !error && matches.length === 0 && (
        <NonIdealState
          icon="tick-circle"
          title="No alerts"
          description={statusFilter ? `No ${statusFilter} alerts.` : 'No alert records found.'}
        />
      )}

      {!isLoading && matches.length > 0 && (
        <div
          ref={scrollRef}
          className="alerts-list-scroll"
          style={{ height: listHeight, maxHeight: ALERT_LIST_MAX_HEIGHT, overflowY: 'auto' }}
        >
          <div className="alerts-list-viewport" style={{ height: totalHeight, position: 'relative' }}>
            <div
              className="alerts-list"
              style={{
                position: 'absolute',
                top: virtualItems[0]?.start ?? 0,
                left: 0,
                right: 0,
              }}
            >
              {virtualItems.map((vItem) => {
                const match = matches[vItem.index]
                return (
                  <div
                    key={match.id}
                    data-index={vItem.index}
                    ref={virtualizer.measureElement}
                    className="alerts-list-item"
                  >
                    <AlertRow
                      match={match}
                      canTriage={canTriageAlerts}
                      isChecked={selectedIds.has(match.id)}
                      someSelected={someSelected}
                      rowIndex={vItem.index}
                      onCheck={handleRowCheck}
                      onChainClick={setChainMatch}
                      isReadOnly={isReplaying}
                      isFocused={focusedIndex === vItem.index}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Load more ── */}
      {hasNextPage && !isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
          <Button
            loading={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
            icon="chevron-down"
            minimal
          >
            Load more ({totalCount !== null ? totalCount - matches.length : '…'} remaining)
          </Button>
        </div>
      )}
      {!hasNextPage && !isLoading && matches.length > 0 && (
        <p className="bp6-text-muted" style={{ textAlign: 'center', fontSize: 12, padding: '8px 0' }}>
          All {matches.length} alerts loaded
        </p>
      )}

      {/* ── Bulk close confirmation ── */}
      <Alert
        isOpen={confirmClose}
        intent="danger"
        icon="cross-circle"
        confirmButtonText={`Close ${selectedIds.size} alert${selectedIds.size !== 1 ? 's' : ''}`}
        cancelButtonText="Cancel"
        loading={bulkMutate.isPending}
        onConfirm={() => executeBulk('closed')}
        onCancel={() => setConfirmClose(false)}
      >
        <p>
          Close <strong>{selectedIds.size}</strong> selected alert{selectedIds.size !== 1 ? 's' : ''}?
          Alerts in a state that doesn't allow closure will be skipped.
        </p>
      </Alert>

      <AlertChainDrawer match={chainMatch} onClose={() => setChainMatch(null)} />
        </>
      )}
    </div>
  )
}
