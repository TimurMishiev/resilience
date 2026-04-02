import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type { Site } from '../api/types'
import type { GlobeBenchmarkState, GlobeBenchmarkApi } from '../components/globe/types'

interface UseGlobeBenchmarkBridgeParams {
  perfEnabled:     boolean
  stateRef:        MutableRefObject<GlobeBenchmarkState>
  sitesRef:        MutableRefObject<Site[]>
  flyToHomeRef:    MutableRefObject<() => void>
  setSelectedSiteId:   (id: string | null) => void
  setSelectedAssetId:  (id: string | null) => void
  setSelectedSignalId: (id: string | null) => void
}

export function useGlobeBenchmarkBridge({
  perfEnabled,
  stateRef,
  sitesRef,
  flyToHomeRef,
  setSelectedSiteId,
  setSelectedAssetId,
  setSelectedSignalId,
}: UseGlobeBenchmarkBridgeParams) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!perfEnabled) {
      delete window.__resilienceGlobeBench
      return
    }

    const benchApi: GlobeBenchmarkApi = {
      getState: () => ({ ...stateRef.current }),
      getBenchmarkTarget: () => stateRef.current.benchmarkTarget,
      focusSite: (siteId: string) => {
        if (!sitesRef.current.some(site => site.id === siteId)) return false
        setSelectedSiteId(siteId)
        setSelectedAssetId(null)
        setSelectedSignalId(null)
        return true
      },
      focusBestSite: () => {
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
      flyHome: () => flyToHomeRef.current(),
      clearPerf: () => window.__resiliencePerf?.clear(),
      getPerfEvents: () => window.__resiliencePerf?.events ?? [],
    }
    window.__resilienceGlobeBench = benchApi

    return () => {
      if (window.__resilienceGlobeBench === benchApi) {
        delete window.__resilienceGlobeBench
      }
    }
  }, [perfEnabled, stateRef, sitesRef, flyToHomeRef, setSelectedSiteId, setSelectedAssetId, setSelectedSignalId])
}
