import { useEffect } from 'react'
import type { Site } from '../api/types'

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

type MapE2ESelectionTarget = {
  id: string
  name: string
}

type MapE2ECanvasPoint = {
  x: number
  y: number
}

type MapE2EApi = {
  getState: () => {
    mapLoaded: boolean
    zoom: number | null
    telemetryConnected: boolean
    signalsConnected: boolean
    signalCount: number
    selectedSiteId: string | null
    selectedAssetId: string | null
    selectedSignalId: string | null
  }
  getFirstSiteTarget: () => MapE2ESelectionTarget | null
  projectPosition: (lng: number, lat: number) => MapE2ECanvasPoint | null
  getPickableSiteCanvasTarget: (siteId: string) => MapE2ECanvasPoint | null
}

declare global {
  interface Window {
    __resilienceMapE2E?: MapE2EApi
  }
}

interface UseMapE2EBridgeProps {
  mapLoaded: boolean
  getZoom: () => number | null
  telemetryConnected: boolean
  signalsConnected: boolean
  signalCount: number
  selectedSiteId: string | null
  selectedAssetId: string | null
  selectedSignalId: string | null
  sites: Site[]
  projectPosition: (lng: number, lat: number) => MapE2ECanvasPoint | null
  inspectCanvasPosition: (x: number, y: number) => { kind: string; id: string | null } | null
}

export function useMapE2EBridge({
  mapLoaded,
  getZoom,
  telemetryConnected,
  signalsConnected,
  signalCount,
  selectedSiteId,
  selectedAssetId,
  selectedSignalId,
  sites,
  projectPosition,
  inspectCanvasPosition,
}: UseMapE2EBridgeProps) {
  useEffect(() => {
    if (typeof window === 'undefined') return

    if (window.localStorage.getItem('resilience.e2e') !== '1') {
      delete window.__resilienceMapE2E
      return
    }

    window.__resilienceMapE2E = {
      getState: () => ({
        mapLoaded,
        zoom: getZoom(),
        telemetryConnected,
        signalsConnected,
        signalCount,
        selectedSiteId,
        selectedAssetId,
        selectedSignalId,
      }),
      getFirstSiteTarget: () => {
        const site = sites[0]
        return site ? { id: site.id, name: site.name } : null
      },
      projectPosition: (lng: number, lat: number) => projectPosition(lng, lat),
      getPickableSiteCanvasTarget: (siteId: string) => {
        const site = sites.find(candidate => candidate.id === siteId)
        if (!site) return null

        const basePoint = projectPosition(Number(site.longitude), Number(site.latitude))
        if (!basePoint) return null

        for (const offset of E2E_PICK_SEARCH_OFFSETS) {
          const x = basePoint.x + offset.x
          const y = basePoint.y + offset.y
          const inspection = inspectCanvasPosition(x, y)
          if (inspection?.kind === 'site' && inspection.id === siteId) {
            return { x, y }
          }
        }

        return null
      },
    }

    return () => {
      delete window.__resilienceMapE2E
    }
  }, [
    getZoom,
    inspectCanvasPosition,
    mapLoaded,
    projectPosition,
    selectedAssetId,
    selectedSignalId,
    selectedSiteId,
    signalCount,
    signalsConnected,
    sites,
    telemetryConnected,
  ])
}
