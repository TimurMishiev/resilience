import { useMemo } from 'react'
import { isPerfEnabled } from '../lib/perfInstrumentation'
import { useAllSites } from './useSites'
import { useAllTasks } from './useTasks'
import { useAllAssets } from './useAssets'
import { useTelemetry } from './useTelemetry'
import { useAllAreasOfOperation } from './useAreasOfOperation'
import { useSignalsLive } from './useSignals'
import { buildSyntheticBenchSignals, readBenchSignalCount } from '../lib/benchSyntheticSignals'
import { useRiskScores } from './useRiskScores'
import { useActiveBreachSiteIds } from './useSignalRuleMatches'
import { useActiveSiteConfidence } from './useActiveSiteConfidence'
import { useAllChokepoints } from './useChokepoints'
import { useAssetTrails } from './useAssetTrails'
import { useReplayEventPulses } from './useReplayEventPulses'
import { useReplayParams } from './useReplayParams'
import { buildCoverageCircles } from '../lib/coverage'
import type { Signal } from '../api/types'

type ReplayParamShapes = ReturnType<typeof useReplayParams>

type UseMapPageDataArgs = {
  asOf: string | null
  asOfParam: ReplayParamShapes['asOfParam']
  isReplaying: boolean
  signalQueryParams: ReplayParamShapes['signalQueryParams']
  trailWindowMinutes: number
}

export function useMapPageData({
  asOf,
  asOfParam,
  isReplaying,
  signalQueryParams,
  trailWindowMinutes,
}: UseMapPageDataArgs) {
  const { data: riskData } = useRiskScores(asOfParam, { refetchInterval: isReplaying ? false : 60_000 })
  const riskBySiteId = useMemo(
    () => Object.fromEntries((riskData ?? []).map(risk => [String(risk.site_id), risk])),
    [riskData],
  )

  const sitesQuery = useAllSites(asOfParam)
  const tasksQuery = useAllTasks(asOfParam)
  const assetsQuery = useAllAssets(asOfParam)
  const { data: areasRes } = useAllAreasOfOperation(asOfParam)

  const areaOfOperations = useMemo(() => areasRes?.data ?? [], [areasRes?.data])
  const sites = useMemo(() => sitesQuery.data?.data ?? [], [sitesQuery.data?.data])
  const allTasks = useMemo(() => tasksQuery.data?.data ?? [], [tasksQuery.data?.data])
  const assets = useMemo(() => assetsQuery.data?.data ?? [], [assetsQuery.data?.data])
  const loading = sitesQuery.isLoading || tasksQuery.isLoading
  const error = sitesQuery.error?.message ?? tasksQuery.error?.message ?? null

  const benchSignalCount = useMemo(
    () => (isPerfEnabled() ? readBenchSignalCount() : null),
    [],
  )
  const syntheticBenchSignals = useMemo<Signal[] | null>(
    () => (benchSignalCount === null ? null : buildSyntheticBenchSignals(benchSignalCount)),
    [benchSignalCount],
  )

  const liveSignals = useSignalsLive({
    enabled: syntheticBenchSignals === null,
    asOf,
    replayParams: signalQueryParams,
  })
  const signals = syntheticBenchSignals ?? liveSignals.signals
  const signalsConnected = syntheticBenchSignals !== null ? true : liveSignals.connected
  const signalError = syntheticBenchSignals !== null ? null : liveSignals.error

  const assetTrails = useAssetTrails(isReplaying ? asOf : null, trailWindowMinutes)

  const { data: activeBreachRes } = useActiveBreachSiteIds(asOfParam, {
    enabled: true,
    refetchInterval: isReplaying ? false : 10_000,
  })
  const breachedSiteIds = useMemo(
    () => new Set<string>(activeBreachRes?.site_ids ?? []),
    [activeBreachRes?.site_ids],
  )

  const { data: confidenceSummaryRes } = useActiveSiteConfidence(asOfParam, {
    enabled: isReplaying,
    refetchInterval: false,
  })
  const confidenceHaloSummaries = useMemo(
    () => confidenceSummaryRes?.summaries ?? [],
    [confidenceSummaryRes?.summaries],
  )

  const { readings, connected: telemetryConnected } = useTelemetry(true, isReplaying ? asOf : null)

  const { data: chokepointsRes } = useAllChokepoints(asOfParam, true)
  const chokepoints = useMemo(
    () => chokepointsRes?.data ?? [],
    [chokepointsRes?.data],
  )

  const coverageCircles = useMemo(() => buildCoverageCircles({
    assets,
    tasks: allTasks,
    sites,
    readings,
    allowHistoricalTelemetry: isReplaying,
  }), [assets, allTasks, isReplaying, readings, sites])

  const replayPulses = useReplayEventPulses({ asOf, isReplaying, sites })

  return {
    allTasks,
    areaOfOperations,
    assetTrails,
    assets,
    assetsLoaded: assetsQuery.isSuccess,
    breachedSiteIds,
    chokepoints,
    confidenceHaloSummaries,
    coverageCircles,
    error,
    loading,
    readings,
    replayPulses,
    riskBySiteId,
    signalError,
    signals,
    signalsConnected,
    sites,
    sitesLoaded: sitesQuery.isSuccess,
    telemetryConnected,
  }
}
