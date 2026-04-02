import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import { assetDisplayPosition } from '../lib/assetPresentation'
import { SIGNAL_LABELS } from '../lib/signalConfig'
import type { GlobeE2EBridgeState } from '../components/globe/types'

// Spiral search offsets used to locate a rendered entity near its projected point.
const E2E_PICK_SEARCH_OFFSETS: Array<{ x: number; y: number }> = (() => {
  const offsets = [{ x: 0, y: 0 }]
  for (let radius = 2; radius <= 30; radius += 2) {
    for (let y = -radius; y <= radius; y += 2) {
      for (let x = -radius; x <= radius; x += 2) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== radius) continue
        offsets.push({ x, y })
      }
    }
  }
  return offsets
})()

const E2E_SIGNAL_FOCUS_HEIGHT_M = 2_500_000

export function useGlobeE2EBridge(
  bridgeStateRef: MutableRefObject<GlobeE2EBridgeState | null>,
) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem('resilience.e2e') !== '1') {
      delete window.__resilienceGlobeE2E
      return
    }

    const getBridgeState = () => bridgeStateRef.current

    const pickRenderedEntity = (expectedIdString: string) => {
      const state = getBridgeState()
      if (!state) return false
      const point = state.projectRenderedPosition(expectedIdString)
      if (!point) return false
      for (const offset of E2E_PICK_SEARCH_OFFSETS) {
        const x = point.x + offset.x
        const y = point.y + offset.y
        const result = state.inspectCanvasPosition(x, y)
        if (result.idString !== expectedIdString) continue
        return state.pickCanvasPosition(x, y)
      }
      return false
    }

    window.__resilienceGlobeE2E = {
      getState: () => ({
        viewerReady:      getBridgeState()?.viewerReady ?? false,
        selectedSiteId:   getBridgeState()?.selectedSiteId ?? null,
        selectedAssetId:  getBridgeState()?.selectedAssetId ?? null,
        selectedSignalId: getBridgeState()?.selectedSignalId ?? null,
        signalCount:      getBridgeState()?.signals.length ?? 0,
      }),
      getFirstSiteTarget: () => {
        const site = getBridgeState()?.sites[0]
        return site
          ? { id: site.id, name: site.name, latitude: Number(site.latitude), longitude: Number(site.longitude) }
          : null
      },
      getFirstSignalTarget: () => {
        const signal = getBridgeState()?.signals[0]
        return signal
          ? {
              id: signal.id,
              name: SIGNAL_LABELS[signal.signal_type] ?? signal.signal_type,
              latitude: Number(signal.lat),
              longitude: Number(signal.lng),
            }
          : null
      },
      getFirstGeofenceTarget: () => {
        const site = getBridgeState()?.sites.find(s => s.geofence_radius_km > 0) ?? null
        return site
          ? { id: site.id, name: site.name, latitude: Number(site.latitude), longitude: Number(site.longitude) }
          : null
      },
      getFirstCoverageTarget: () => {
        const state = getBridgeState()
        if (!state) return null
        const coverageAssetId = state.coverageCircles[0]?.assetId ?? null
        const coverageAsset = coverageAssetId
          ? (state.assets.find(a => a.id === coverageAssetId) ?? null)
          : null
        const coords = coverageAsset
          ? assetDisplayPosition(coverageAsset, state.sites, state.readings, { lat: 0, lng: 0 }, { allowHistorical: state.isReplaying })
          : null
        return coverageAsset
          ? { id: coverageAsset.id, name: coverageAsset.name, latitude: coords?.lat ?? 0, longitude: coords?.lng ?? 0 }
          : null
      },
      projectPosition:         (lng, lat) => getBridgeState()?.projectPosition(lng, lat) ?? null,
      projectRenderedPosition: (idString) => getBridgeState()?.projectRenderedPosition(idString) ?? null,
      flyToSite: (siteId) => {
        const state = getBridgeState()
        if (!state) return false
        const site = state.sites.find(s => s.id === siteId)
        if (!site) return false
        state.focusPosition(Number(site.longitude), Number(site.latitude), 1_200_000, -70)
        return true
      },
      flyToAsset: (assetId) => {
        const state = getBridgeState()
        if (!state) return false
        const asset = state.assets.find(a => a.id === assetId)
        if (!asset) return false
        const coords = assetDisplayPosition(asset, state.sites, state.readings, { lat: 0, lng: 0 }, { allowHistorical: state.isReplaying })
        state.focusPosition(coords.lng, coords.lat, 850_000)
        return true
      },
      flyToSignal: (signalId) => {
        const state = getBridgeState()
        if (!state) return false
        const signal = state.signals.find(s => s.id === signalId)
        if (!signal) return false
        state.focusPosition(Number(signal.lng), Number(signal.lat), E2E_SIGNAL_FOCUS_HEIGHT_M, -68)
        return true
      },
      inspectProjectedPosition: (lng, lat) => {
        const state = getBridgeState()
        if (!state) return null
        const point = state.projectPosition(lng, lat)
        if (!point) return null
        return state.inspectCanvasPosition(point.x, point.y)
      },
      pickProjectedPosition: (lng, lat) => {
        const state = getBridgeState()
        if (!state) return false
        const point = state.projectPosition(lng, lat)
        if (!point) return false
        return state.pickCanvasPosition(point.x, point.y)
      },
      pickSiteThroughGeofenceOverlay: (siteId) => {
        const state = getBridgeState()
        if (!state) return false
        const site = state.sites.find(s => s.id === siteId)
        if (!site || site.geofence_radius_km <= 0) return false
        return state.dispatchSyntheticPick([`geofence-${site.id}`, `site-${site.id}`])
      },
      pickSite:  (siteId)  => { const s = getBridgeState()?.sites.find(s => s.id === siteId); return s ? pickRenderedEntity(`site-${s.id}`) : false },
      pickAsset: (assetId) => { const a = getBridgeState()?.assets.find(a => a.id === assetId); return a ? pickRenderedEntity(`asset-${a.id}`) : false },
    }

    return () => {
      delete window.__resilienceGlobeE2E
    }
  }, [bridgeStateRef])
}
