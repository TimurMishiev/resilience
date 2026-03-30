import type { Signal } from '../api/types'

const DEFAULT_CELL_SIZE_DEGREES = 2.5

const SIGNAL_HEATMAP_WEIGHTS: Partial<Record<Signal['signal_type'], number>> = {
  seismic_event: 1.3,
  wildfire: 1.25,
  conflict_event: 1.15,
  disaster_alert: 1.15,
  gps_jamming: 1.1,
}

export interface GlobeHeatmapCell {
  key: string
  lat: number
  lng: number
  count: number
  weight: number
  intensity: number
}

function normalizeLongitude(lng: number) {
  const normalized = ((lng + 180) % 360 + 360) % 360 - 180
  return normalized === -180 ? 180 : normalized
}

function heatmapWeight(signal: Signal) {
  return SIGNAL_HEATMAP_WEIGHTS[signal.signal_type] ?? 1
}

export function buildGlobeSignalHeatmapCells(
  signals: Signal[],
  cellSizeDegrees = DEFAULT_CELL_SIZE_DEGREES,
): GlobeHeatmapCell[] {
  if (signals.length === 0) return []

  const latCellCount = Math.max(1, Math.ceil(180 / cellSizeDegrees))
  const lngCellCount = Math.max(1, Math.ceil(360 / cellSizeDegrees))
  const buckets = new Map<string, { latIndex: number; lngIndex: number; count: number; weight: number }>()

  for (const signal of signals) {
    const lat = Number(signal.lat)
    const lng = normalizeLongitude(Number(signal.lng))
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    const clampedLat = Math.max(-89.9999, Math.min(89.9999, lat))
    const latIndex = Math.max(0, Math.min(latCellCount - 1, Math.floor((clampedLat + 90) / cellSizeDegrees)))
    const lngIndex = Math.max(0, Math.min(lngCellCount - 1, Math.floor((lng + 180) / cellSizeDegrees)))
    const key = `${latIndex}:${lngIndex}`

    const bucket = buckets.get(key)
    if (bucket) {
      bucket.count += 1
      bucket.weight += heatmapWeight(signal)
      continue
    }

    buckets.set(key, {
      latIndex,
      lngIndex,
      count: 1,
      weight: heatmapWeight(signal),
    })
  }

  if (buckets.size === 0) return []

  let maxWeight = 0
  for (const bucket of buckets.values()) {
    if (bucket.weight > maxWeight) maxWeight = bucket.weight
  }
  if (maxWeight <= 0) maxWeight = 1

  return Array.from(buckets.entries())
    .map(([key, bucket]) => ({
      key,
      lat: -90 + (bucket.latIndex + 0.5) * cellSizeDegrees,
      lng: -180 + (bucket.lngIndex + 0.5) * cellSizeDegrees,
      count: bucket.count,
      weight: bucket.weight,
      intensity: bucket.weight / maxWeight,
    }))
    .sort((a, b) => b.weight - a.weight || b.count - a.count || a.key.localeCompare(b.key))
}
