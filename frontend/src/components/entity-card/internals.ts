import type { Intent } from '@blueprintjs/core'
import { deriveFreshness, type FreshnessThresholds } from '../../lib/freshness'

export type EntityType = 'task' | 'asset' | 'site' | 'ao'

export const AUDIT_ENTITY_TYPE: Record<EntityType, string> = {
  task:  'Task',
  asset: 'Asset',
  site:  'Site',
  ao:    'AreaOfOperation',
}

export const ASSET_FRESHNESS_THRESHOLDS: FreshnessThresholds = {
  agingMs: 6 * 3_600_000,
  staleMs: 24 * 3_600_000,
}

export const THREAT_INTENT: Record<string, Intent> = {
  green: 'success', amber: 'warning', red: 'danger', black: 'none',
}

export function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function staleness(last_reported_at: string | null, updated_at: string, referenceTimeMs: number) {
  const timestamp = last_reported_at ?? updated_at
  const updatedAtMs = Date.parse(timestamp)

  if (!Number.isFinite(updatedAtMs)) {
    return { label: 'unknown', intent: 'warning' as Intent }
  }

  const freshness = deriveFreshness(updatedAtMs, referenceTimeMs, ASSET_FRESHNESS_THRESHOLDS)
  if (freshness === 'fresh') return null
  if (freshness === 'unavailable') return { label: 'unknown', intent: 'warning' as Intent }

  const ageH = (referenceTimeMs - updatedAtMs) / 3_600_000
  if (freshness === 'aging') {
    return { label: `${Math.round(ageH)}h ago`, intent: 'warning' as Intent }
  }

  return { label: `${Math.round(ageH / 24)}d ago`, intent: 'danger' as Intent }
}

export function replayParams(asOf?: string | null) {
  return asOf ? { as_of: asOf } : undefined
}

export function metaLine(asOf: string | null | undefined, liveText: string) {
  return asOf ? `Historical view as of ${fmt(asOf)}` : liveText
}
