/**
 * Replay event pulses — Tranche 6-A.
 *
 * Pure helpers for the cinematic-replay pulse layer. Given a window of
 * audit events around the current replay cursor (asOf) and a map of
 * already-loaded sites by id, produce a bounded list of pulses with
 * resolved {lat,lng} and an intensity fraction (1.0 at cursor, falling
 * off linearly to 0.0 at the window edge).
 *
 * Hook (useReplayEventPulses), layer module (mapEngineReplayPulseLayers),
 * and the MapLibre sub-hook (useMapReplayPulseLayers) consume these.
 *
 * High-signal event types only — see [HIGH_SIGNAL_PULSE_EVENT_TYPES]
 * below. Anything else is filtered out by the backend query, but the
 * client also caps at MAX_PULSES sorted by proximity to asOf so a
 * dense burst of low-signal events can never swamp the layer.
 */

import type { AuditEvent, Site } from '../api/types'

export const HIGH_SIGNAL_PULSE_EVENT_TYPES = [
  'site_flagged',
  'incident.opened',
  'incident_transitioned',
  'task.transitioned',
  'prosecution_started',
] as const

export type PulseEventType = typeof HIGH_SIGNAL_PULSE_EVENT_TYPES[number]

/** ±5 minutes around the cursor. */
export const PULSE_WINDOW_MS = 5 * 60 * 1000
/** Cap pulses kept on the layer, sorted by |occurredAt - asOf|. */
export const MAX_PULSES = 50

export interface Pulse {
  id: string
  lat: number
  lng: number
  eventType: PulseEventType
  occurredAt: string
  /** 0.0 (PULSE_WINDOW_MS in the past) → 1.0 (at cursor). */
  intensity: number
}

interface SiteCoord {
  lat: number
  lng: number
}

function coerceFloat(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function buildSitesById(sites: readonly Site[]): Map<string, SiteCoord> {
  const map = new Map<string, SiteCoord>()
  for (const site of sites) {
    const lat = coerceFloat(site.latitude)
    const lng = coerceFloat(site.longitude)
    if (lat === null || lng === null) continue
    map.set(site.id, { lat, lng })
  }
  return map
}

/**
 * Resolve an audit event to a {lat,lng} via already-loaded sites.
 * Site events resolve directly; Task/Incident/SignalRuleMatch events
 * resolve via `after_snapshot.site_id` (or `before_snapshot.site_id`
 * as fallback, which matters for delete-style transitions whose
 * after_snapshot may be empty). Returns null when no site_id is
 * extractable or the site is not in the loaded map (e.g. out of the
 * current org scope).
 */
export function resolvePulseLocation(
  event: AuditEvent,
  sitesById: ReadonlyMap<string, SiteCoord>,
): SiteCoord | null {
  let siteId: string | null = null

  if (event.entity_type === 'Site') {
    siteId = event.entity_id
  } else {
    const after = event.after_snapshot
    const before = event.before_snapshot
    const fromAfter = (after && typeof after.site_id === 'string') ? after.site_id : null
    const fromBefore = (before && typeof before.site_id === 'string') ? before.site_id : null
    siteId = fromAfter ?? fromBefore
  }

  if (!siteId) return null
  return sitesById.get(siteId) ?? null
}

function isPulseEventType(value: string): value is PulseEventType {
  return (HIGH_SIGNAL_PULSE_EVENT_TYPES as readonly string[]).includes(value)
}

/**
 * Build the bounded pulse list. Filters to high-signal types, resolves
 * locations, computes intensity from how recently the event occurred
 * relative to the cursor, sorts by proximity to asOf, and caps at
 * MAX_PULSES.
 *
 * Past-only by design: events at occurredAt > asOf are dropped because
 * cinematically they have not "happened yet" in the timeline. The hook
 * fetches a forward-extending window from the server (so cached events
 * remain useful as the cursor advances within an epoch); this filter
 * is what enforces the past-only cursor narrative.
 */
export function buildPulses(
  events: readonly AuditEvent[],
  sitesById: ReadonlyMap<string, SiteCoord>,
  asOfMs: number,
): Pulse[] {
  const candidates: Pulse[] = []
  for (const event of events) {
    if (!isPulseEventType(event.event_type)) continue
    const location = resolvePulseLocation(event, sitesById)
    if (!location) continue
    const occurredMs = Date.parse(event.occurred_at)
    if (!Number.isFinite(occurredMs)) continue
    if (occurredMs > asOfMs) continue
    const distanceMs = asOfMs - occurredMs
    if (distanceMs > PULSE_WINDOW_MS) continue
    const intensity = Math.max(0, 1 - distanceMs / PULSE_WINDOW_MS)
    candidates.push({
      id: event.id,
      lat: location.lat,
      lng: location.lng,
      eventType: event.event_type as PulseEventType,
      occurredAt: event.occurred_at,
      intensity,
    })
  }

  candidates.sort((a, b) => b.intensity - a.intensity)
  return candidates.slice(0, MAX_PULSES)
}

/**
 * Visual color per event type. Kept in this module so the legend in
 * MapOverlayControls and the layer paint expression stay in sync.
 */
export const PULSE_COLORS: Record<PulseEventType, string> = {
  site_flagged:          '#fa5252', // red — site flagged by correlation rule
  'incident.opened':     '#ff922b', // amber — incident opened
  incident_transitioned: '#fcc419', // yellow — workflow change on an incident
  'task.transitioned':   '#3ddc84', // green — task moved (often resolved)
  prosecution_started:   '#cc5de8', // purple — prosecution escalation
}

export const PULSE_LABELS: Record<PulseEventType, string> = {
  site_flagged:          'Site flagged',
  'incident.opened':     'Incident opened',
  incident_transitioned: 'Incident workflow',
  'task.transitioned':   'Task transition',
  prosecution_started:   'Prosecution',
}
