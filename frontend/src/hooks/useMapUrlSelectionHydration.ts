import { useEffect, type Dispatch, type SetStateAction, type MutableRefObject } from 'react'
import type { Location } from 'react-router-dom'
import { assetDisplayPosition } from '../lib/assetPresentation'
import { parseEntitySelectionRoute } from '../lib/entitySelectionRoute'
import type { Asset, Signal, Site } from '../api/types'
import type { TelemetryReading } from '../lib/telemetry'

interface UseMapUrlSelectionHydrationParams {
  mapLoaded: boolean
  location: Location
  sites: Site[]
  assets: Asset[]
  signals: Signal[]
  readings: TelemetryReading[]
  isReplaying: boolean
  flyTo: (center: [number, number], zoom: number) => void
  urlSelectionAppliedRef: MutableRefObject<boolean>
  setSelectedSiteId: Dispatch<SetStateAction<string | null>>
  setSelectedAssetId: Dispatch<SetStateAction<string | null>>
  setSelectedSignalId: Dispatch<SetStateAction<string | null>>
}

// One-shot URL → initial selection hydration for /map.
//
// Fires once per navigation after the MapLibre engine reports loaded. Reads
// the deep-link query (?site_id, ?asset_id, ?signal_id), resolves it against
// the freshly-fetched dataset, sets selection state, and centers the camera.
// `urlSelectionAppliedRef` is the latch — set to true after the first
// successful application so subsequent renders (filter changes, replay
// scrubs, layer toggles) do not re-trigger camera moves.
//
// If a deep-linked entity is not present in the dataset (e.g. SSE has not
// yet delivered the signal), the effect early-returns without marking the
// ref applied so a later render — when the dataset arrives — completes the
// hydration. The "no deep-link in URL" branch sets all selection to null
// and marks applied immediately.
export function useMapUrlSelectionHydration({
  mapLoaded,
  location,
  sites,
  assets,
  signals,
  readings,
  isReplaying,
  flyTo,
  urlSelectionAppliedRef,
  setSelectedSiteId,
  setSelectedAssetId,
  setSelectedSignalId,
}: UseMapUrlSelectionHydrationParams): void {
  useEffect(() => {
    if (!mapLoaded || urlSelectionAppliedRef.current) return

    const { siteId, assetId, signalId } = parseEntitySelectionRoute(location.search)

    if (!siteId && !assetId && !signalId) {
      setSelectedSiteId(null)
      setSelectedAssetId(null)
      setSelectedSignalId(null)
      urlSelectionAppliedRef.current = true
      return
    }
    if (siteId) {
      const site = sites.find(s => s.id === siteId)
      if (!site) return
      setSelectedSiteId(site.id)
      setSelectedAssetId(null)
      setSelectedSignalId(null)
      flyTo([Number(site.longitude), Number(site.latitude)], 6)
      urlSelectionAppliedRef.current = true
      return
    }

    if (assetId) {
      const asset = assets.find(a => a.id === assetId)
      if (!asset) return
      const { lat, lng } = assetDisplayPosition(asset, sites, readings, { lat: 37.7749, lng: -122.4194 }, { allowHistorical: isReplaying })
      setSelectedSiteId(null)
      setSelectedAssetId(asset.id)
      setSelectedSignalId(null)
      flyTo([lng, lat], 7)
      urlSelectionAppliedRef.current = true
      return
    }

    if (signalId) {
      const signal = signals.find(s => s.id === signalId)
      if (!signal) return
      setSelectedSiteId(null)
      setSelectedAssetId(null)
      setSelectedSignalId(signal.id)
      flyTo([Number(signal.lng), Number(signal.lat)], 7)
      urlSelectionAppliedRef.current = true
    }
  }, [
    assets,
    flyTo,
    isReplaying,
    location.search,
    mapLoaded,
    readings,
    setSelectedAssetId,
    setSelectedSignalId,
    setSelectedSiteId,
    signals,
    sites,
    urlSelectionAppliedRef,
  ])
}
