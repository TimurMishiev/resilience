import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  buildEntitySelectionSearch,
  buildEntitySelectionSyncLocationState,
  consumeEntitySelectionSyncLocationState,
  isEntitySelectionRouteAuthoritative,
  parseEntitySelectionRoute,
  shouldClearEntitySelectionAfterLoad,
  trackEntitySelectionSyncToken,
} from '../lib/entitySelectionRoute'
import type { EntitySelectionSyncSource } from '../lib/entitySelectionRoute'

export interface EntitySelectionSyncOptions {
  source: EntitySelectionSyncSource
  signals: { id: string }[]
  signalsConnected: boolean
  signalError: unknown
  sites: { id: string }[]
  assets: { id: string }[]
  sitesLoaded: boolean
  assetsLoaded: boolean
  isReplaying: boolean
  asOf: string | null
}

export interface EntitySelectionSyncResult {
  selectedSiteId: string | null
  selectedAssetId: string | null
  selectedSignalId: string | null
  setSelectedSiteId: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedAssetId: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedSignalId: React.Dispatch<React.SetStateAction<string | null>>
  onSiteClick: (siteId: string | null) => void
  onAssetClick: (assetId: string | null) => void
  onSignalClick: (signalId: string | null) => void
  updateSelectionRoute: (selection: { siteId: string | null; assetId: string | null; signalId: string | null }) => void
  updateSelectionRouteRef: React.MutableRefObject<(selection: { siteId: string | null; assetId: string | null; signalId: string | null }) => void>
  urlSelectionAppliedRef: React.MutableRefObject<boolean>
}

export function useEntitySelectionSync(options: EntitySelectionSyncOptions): EntitySelectionSyncResult {
  const {
    source, signals, signalsConnected, signalError,
    sites, assets, sitesLoaded, assetsLoaded,
    isReplaying,
    // `asOf` is still part of the input contract (callers pass it
    // alongside isReplaying) but no longer needed inside the hook
    // after Tranche 6-C deleted the replay-reset effect. Kept on the
    // options type to preserve the call-site contract; intentionally
    // not destructured here to avoid an unused binding.
  } = options

  const location = useLocation()
  const navigate = useNavigate()

  const urlSelectionAppliedRef      = useRef(false)
  const nextRouteWriteTokenRef      = useRef(0)
  const pendingRouteWriteTokensRef  = useRef<Set<number>>(new Set())

  // ── Selection state ─────────────────────────────────────────────────────────
  const [selectedSiteId,   setSelectedSiteId]   = useState<string | null>(null)
  const [selectedAssetId,  setSelectedAssetId]  = useState<string | null>(null)
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null)

  // ── SSE grace period ────────────────────────────────────────────────────────
  const [signalsSettledKey, setSignalsSettledKey] = useState<string | null>(null)
  const signalsSettledTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const signalsSettledTimerForRef = useRef<string | null>(null)

  useEffect(() => {
    if (!signalsConnected || signalError != null) {
      /* eslint-disable react-hooks/set-state-in-effect -- Resets internal grace-window state on disconnect or error */
      setSignalsSettledKey(null)
      /* eslint-enable react-hooks/set-state-in-effect */
      signalsSettledTimerForRef.current = null
      if (signalsSettledTimerRef.current != null) {
        clearTimeout(signalsSettledTimerRef.current)
        signalsSettledTimerRef.current = null
      }
      return
    }

    const routeSignalId = parseEntitySelectionRoute(location.search).signalId
    if (routeSignalId == null) return

    if (
      signalsSettledTimerRef.current != null &&
      signalsSettledTimerForRef.current !== location.key
    ) {
      clearTimeout(signalsSettledTimerRef.current)
      signalsSettledTimerRef.current = null
      signalsSettledTimerForRef.current = null
    }

    if (signalsSettledTimerRef.current != null) return

    const thisKey = location.key
    signalsSettledTimerForRef.current = thisKey
    signalsSettledTimerRef.current = setTimeout(() => {
      setSignalsSettledKey(thisKey)
      signalsSettledTimerRef.current = null
    }, 1500)

    return () => {
      if (signalsSettledTimerRef.current != null) {
        clearTimeout(signalsSettledTimerRef.current)
        signalsSettledTimerRef.current = null
      }
    }
  }, [signalsConnected, signalError, location.search, location.key])

  // ── Route management ────────────────────────────────────────────────────────
  const updateSelectionRoute = useCallback((selection: {
    siteId: string | null; assetId: string | null; signalId: string | null
  }) => {
    const nextSearch = buildEntitySelectionSearch(location.search, selection)
    if (nextSearch === location.search) return

    const token = nextRouteWriteTokenRef.current + 1
    nextRouteWriteTokenRef.current = token
    trackEntitySelectionSyncToken(pendingRouteWriteTokensRef.current, token)
    navigate(
      { pathname: location.pathname, search: nextSearch },
      { replace: true, state: buildEntitySelectionSyncLocationState(location.state, { source, token }) },
    )
  }, [location.pathname, location.search, location.state, navigate, source])

  const updateSelectionRouteRef = useRef(updateSelectionRoute)
  useEffect(() => { updateSelectionRouteRef.current = updateSelectionRoute }, [updateSelectionRoute])

  // Replay-reset effect deleted in Tranche 6-C. The cinematic-replay
  // contract requires selection to persist across asOf changes while
  // replaying (and across replay-exit when the entity exists in live
  // data). The three remaining clear paths fully cover the contract:
  //   1. Explicit deselect — onSiteClick(null) / panel close.
  //   2. Route/entity switch — URL change re-runs the deep-link effect.
  //   3. Authoritative miss — the stale-selection effect below clears
  //      when the selected id is absent from the canonical asOf dataset
  //      (covers soft-deleted/archived as a hard miss).
  useEffect(() => { urlSelectionAppliedRef.current = false }, [location.search])

  // ── Selection callbacks ─────────────────────────────────────────────────────
  const onSiteClick = useCallback((siteId: string | null) => {
    setSelectedAssetId(null)
    setSelectedSignalId(null)
    setSelectedSiteId(siteId)
    updateSelectionRoute({ siteId, assetId: null, signalId: null })
  }, [updateSelectionRoute])

  const onAssetClick = useCallback((assetId: string | null) => {
    setSelectedSiteId(null)
    setSelectedSignalId(null)
    setSelectedAssetId(assetId)
    updateSelectionRoute({ siteId: null, assetId, signalId: null })
  }, [updateSelectionRoute])

  const onSignalClick = useCallback((signalId: string | null) => {
    setSelectedSiteId(null)
    setSelectedAssetId(null)
    setSelectedSignalId(signalId)
    updateSelectionRoute({ siteId: null, assetId: null, signalId })
  }, [updateSelectionRoute])

  // ── URL deep-link consumption ───────────────────────────────────────────────
  // Pages handle their own deep-link hydration (MapPage calls flyTo, GlobePage
  // calls focusPosition). This hook only consumes sync tokens so the page
  // effect can check urlSelectionAppliedRef.
  useEffect(() => {
    if (urlSelectionAppliedRef.current) return
    if (consumeEntitySelectionSyncLocationState(location.state, source, pendingRouteWriteTokensRef.current)) {
      urlSelectionAppliedRef.current = true
    }
  }, [location.state, source])

  // ── Stale selection clear ───────────────────────────────────────────────────
  useEffect(() => {
    const routeSelection = parseEntitySelectionRoute(location.search)

    const availability = {
      sitesLoaded,
      assetsLoaded,
      signalsLoaded: signalsConnected && signalError == null && (
        isReplaying ||
        urlSelectionAppliedRef.current ||
        routeSelection.signalId == null ||
        signals.some(s => s.id === routeSelection.signalId) ||
        signalsSettledKey === location.key
      ),
      siteIds:   sites.map(s => s.id),
      assetIds:  assets.map(a => a.id),
      signalIds: signals.map(s => s.id),
    }

    const stateSelection = {
      siteId: selectedSiteId,
      assetId: selectedAssetId,
      signalId: selectedSignalId,
    }
    const routeAuthoritative = isEntitySelectionRouteAuthoritative(location.state, source)

    if (!shouldClearEntitySelectionAfterLoad(routeSelection, stateSelection, availability, routeAuthoritative)) {
      return
    }

    /* eslint-disable react-hooks/set-state-in-effect -- When a selected entity disappears, state and URL must be synchronously cleared */
    setSelectedSiteId(null)
    setSelectedAssetId(null)
    setSelectedSignalId(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    updateSelectionRouteRef.current({ siteId: null, assetId: null, signalId: null })
  }, [
    assets, assetsLoaded, isReplaying,
    location.key, location.search, location.state,
    selectedAssetId, selectedSignalId, selectedSiteId,
    signalError, signals, signalsConnected, signalsSettledKey,
    sites, sitesLoaded, source,
  ])

  return {
    selectedSiteId, selectedAssetId, selectedSignalId,
    setSelectedSiteId, setSelectedAssetId, setSelectedSignalId,
    onSiteClick, onAssetClick, onSignalClick,
    updateSelectionRoute, updateSelectionRouteRef,
    urlSelectionAppliedRef,
  }
}
