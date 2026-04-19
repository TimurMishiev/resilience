import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type { Site } from '../api/types'
import type { MapBenchmarkApi, MapBenchmarkState } from '../components/map/types'

interface UseMapBenchmarkBridgeParams {
  perfEnabled:         boolean
  stateRef:            MutableRefObject<MapBenchmarkState>
  sitesRef:            MutableRefObject<Site[]>
  setSelectedSiteId:   (id: string | null) => void
  setSelectedAssetId:  (id: string | null) => void
  setSelectedSignalId: (id: string | null) => void
}

export function useMapBenchmarkBridge({
  perfEnabled,
  stateRef,
  sitesRef,
  setSelectedSiteId,
  setSelectedAssetId,
  setSelectedSignalId,
}: UseMapBenchmarkBridgeParams) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!perfEnabled) {
      delete window.__resilienceMapBench
      return
    }

    const benchApi: MapBenchmarkApi = {
      getState: () => ({ ...stateRef.current }),
      getBenchmarkTarget: () => stateRef.current.benchmarkTarget,
      getSites: () => sitesRef.current.slice(),
      focusSite: (siteId: string) => {
        if (!sitesRef.current.some(site => site.id === siteId)) return false
        setSelectedSiteId(siteId)
        setSelectedAssetId(null)
        setSelectedSignalId(null)
        return true
      },
      focusBenchmarkSite: () => {
        const target = stateRef.current.benchmarkTarget
        if (!target) return null
        setSelectedSiteId(target.siteId)
        setSelectedAssetId(null)
        setSelectedSignalId(null)
        return target
      },
      clearSelection: () => {
        setSelectedSiteId(null)
        setSelectedAssetId(null)
        setSelectedSignalId(null)
      },
      clearPerf: () => window.__resiliencePerf?.clear(),
      getPerfEvents: () => window.__resiliencePerf?.events ?? [],
    }
    window.__resilienceMapBench = benchApi

    return () => {
      if (window.__resilienceMapBench === benchApi) {
        delete window.__resilienceMapBench
      }
    }
  }, [perfEnabled, stateRef, sitesRef, setSelectedSiteId, setSelectedAssetId, setSelectedSignalId])
}
