import type { Asset, Site } from '../api/types'
import { isTelemetryFresh, type TelemetryMap, type TelemetryReading } from './telemetry'

export interface AssetPosition {
  lat: number
  lng: number
}

interface TelemetryLookupOptions {
  allowHistorical?: boolean
}

function hashFraction(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i)
    hash |= 0
  }
  return ((hash >>> 0) % 10_000) / 10_000
}

export function getLiveTelemetryReading(
  assetId: string | null | undefined,
  readings: TelemetryMap,
  options: TelemetryLookupOptions = {},
): TelemetryReading | null {
  if (!assetId) return null
  const reading = readings.get(assetId)
  if (!reading) return null
  return options.allowHistorical || isTelemetryFresh(reading) ? reading : null
}

export function assetSeedPosition(
  assetId: string,
  homeSite: Site | null | undefined,
  fallback: AssetPosition = { lat: 0, lng: 0 },
): AssetPosition {
  if (!homeSite) return fallback

  const latOffset = (hashFraction(`${assetId}-lat`) - 0.5) * 0.05
  const lngOffset = (hashFraction(`${assetId}-lng`) - 0.5) * 0.05

  return {
    lat: Number(homeSite.latitude) + latOffset,
    lng: Number(homeSite.longitude) + lngOffset,
  }
}

export function assetDisplayPosition(
  asset: Asset,
  sites: Site[],
  readings: TelemetryMap,
  fallback: AssetPosition = { lat: 0, lng: 0 },
  options: TelemetryLookupOptions = {},
): AssetPosition {
  const liveReading = getLiveTelemetryReading(asset.id, readings, options)
  if (liveReading) return { lat: liveReading.lat, lng: liveReading.lng }

  const homeSite = sites.find(site => site.id === asset.home_site_id)
  return assetSeedPosition(asset.id, homeSite, fallback)
}
