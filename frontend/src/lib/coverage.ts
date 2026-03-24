import type { Asset, AssetStatus, Site, Task } from '../api/types'
import { isTelemetryFresh } from './telemetry'

export interface Position {
  lat: number
  lng: number
  ts: number
}

export interface CoverageCircle {
  assetId: string
  assetName: string
  assetType: string
  status: AssetStatus
  anchorLat: number
  anchorLng: number
  anchorSource: 'telemetry' | 'task_site' | 'home_site'
  anchorLabel: string
  radiusKm: number
}

const BASE_RADIUS_KM_BY_ASSET_TYPE: Record<string, number> = {
  vehicle: 35,
  equipment: 120,
  personnel: 12,
}

const STATUS_RADIUS_MULTIPLIER: Record<AssetStatus, number> = {
  available: 1,
  assigned: 1,
  degraded: 0.55,
  offline: 0,
}

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}

export function circlePolygon(lat: number, lng: number, radiusKm: number, steps = 64): GeoJSON.Feature {
  const coords: [number, number][] = []
  const latRad = (lat * Math.PI) / 180
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI
    const dLat = ((radiusKm / 6371) * Math.cos(angle) * 180) / Math.PI
    const dLng = ((radiusKm / 6371) * Math.sin(angle) * 180) / Math.PI / Math.cos(latRad)
    coords.push([lng + dLng, lat + dLat])
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  }
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const a = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function assetCoverageRadiusKm(asset: Pick<Asset, 'asset_type' | 'status'>): number {
  const base = BASE_RADIUS_KM_BY_ASSET_TYPE[asset.asset_type] ?? 25
  return Number((base * STATUS_RADIUS_MULTIPLIER[asset.status]).toFixed(1))
}

function taskAnchors(tasks: Task[], sitesById: Map<string, Site>): Array<{ lat: number; lng: number; label: string }> {
  const openTasks = tasks.filter(task => task.workflow_status !== 'resolved' && task.site_id)
  const uniqueBySite = new Map<string, { lat: number; lng: number; label: string }>()
  for (const task of openTasks) {
    const site = sitesById.get(task.site_id)
    if (!site) continue
    uniqueBySite.set(task.site_id, {
      lat: toNumber(site.latitude),
      lng: toNumber(site.longitude),
      label: task.site_name ?? site.name,
    })
  }
  return [...uniqueBySite.values()]
}

export function buildCoverageCircles(params: {
  assets: Asset[]
  tasks: Task[]
  sites: Site[]
  readings?: Map<string, Position>
  allowHistoricalTelemetry?: boolean
}): CoverageCircle[] {
  const { assets, tasks, sites, readings, allowHistoricalTelemetry = false } = params
  const sitesById = new Map(sites.map(site => [site.id, site]))
  const tasksByAssetId = new Map<string, Task[]>()

  for (const task of tasks) {
    if (!task.asset_id) continue
    const existing = tasksByAssetId.get(task.asset_id) ?? []
    existing.push(task)
    tasksByAssetId.set(task.asset_id, existing)
  }

  return assets.flatMap<CoverageCircle>(asset => {
    const radiusKm = assetCoverageRadiusKm(asset)
    if (radiusKm <= 0) return []

    const reading = readings?.get(asset.id)
    const freshReading = reading && (allowHistoricalTelemetry || isTelemetryFresh(reading)) ? reading : null
    if (freshReading) {
      return [{
        assetId: asset.id,
        assetName: asset.name,
        assetType: asset.asset_type,
        status: asset.status,
        anchorLat: freshReading.lat,
        anchorLng: freshReading.lng,
        anchorSource: 'telemetry',
        anchorLabel: asset.name,
        radiusKm,
      }]
    }

    const assignedAnchors = taskAnchors(tasksByAssetId.get(asset.id) ?? [], sitesById)
    if (assignedAnchors.length > 0) {
      return assignedAnchors.map(anchor => ({
        assetId: asset.id,
        assetName: asset.name,
        assetType: asset.asset_type,
        status: asset.status,
        anchorLat: anchor.lat,
        anchorLng: anchor.lng,
        anchorSource: 'task_site' as const,
        anchorLabel: anchor.label,
        radiusKm,
      }))
    }

    const homeSite = asset.home_site_id ? sitesById.get(asset.home_site_id) : null
    if (!homeSite) return []

    return [{
      assetId: asset.id,
      assetName: asset.name,
      assetType: asset.asset_type,
      status: asset.status,
      anchorLat: toNumber(homeSite.latitude),
      anchorLng: toNumber(homeSite.longitude),
      anchorSource: 'home_site',
      anchorLabel: homeSite.name,
      radiusKm,
    }]
  })
}

export function coverageBySite(sites: Site[], circles: CoverageCircle[]): Map<string, CoverageCircle[]> {
  const covered = new Map<string, CoverageCircle[]>()
  for (const site of sites) {
    const siteLat = toNumber(site.latitude)
    const siteLng = toNumber(site.longitude)
    const circlesForSite = circles.filter(circle =>
      haversineKm(siteLat, siteLng, circle.anchorLat, circle.anchorLng) <= circle.radiusKm
    )
    const uniqueByAsset = new Map<string, CoverageCircle>()
    for (const circle of circlesForSite) {
      const existing = uniqueByAsset.get(circle.assetId)
      if (!existing || circle.anchorSource === 'telemetry') uniqueByAsset.set(circle.assetId, circle)
    }
    covered.set(site.id, [...uniqueByAsset.values()])
  }
  return covered
}
