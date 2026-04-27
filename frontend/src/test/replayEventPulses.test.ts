import { describe, it, expect } from 'vitest'
import {
  HIGH_SIGNAL_PULSE_EVENT_TYPES,
  MAX_PULSES,
  PULSE_WINDOW_MS,
  buildPulses,
  buildSitesById,
  resolvePulseLocation,
} from '../lib/replayEventPulses'
import type { AuditEvent, Site } from '../api/types'

const ASOF_MS = Date.parse('2026-04-26T12:00:00.000Z')
const ASOF = '2026-04-26T12:00:00.000Z'

function site(id: string, lat: number, lng: number): Site {
  return {
    id,
    name: `Site ${id}`,
    latitude: lat,
    longitude: lng,
    status: 'active',
    area_of_operation_id: null,
    flagged_at: null,
    flag_reason: null,
    geofence_radius_km: 5,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: overrides.id ?? 'evt-1',
    schema_version: 1,
    actor: 'system',
    entity_type: overrides.entity_type ?? 'Site',
    entity_id: overrides.entity_id ?? 's1',
    event_type: overrides.event_type ?? 'site_flagged',
    action: null,
    before_snapshot: overrides.before_snapshot ?? null,
    after_snapshot: overrides.after_snapshot ?? {},
    metadata: null,
    correlation_id: 'corr-1',
    occurred_at: overrides.occurred_at ?? ASOF,
    ...overrides,
  } as AuditEvent
}

describe('replayEventPulses', () => {
  describe('buildSitesById', () => {
    it('coerces string lat/lng to numbers', () => {
      // Rails serializes decimal columns as strings; the Site type encodes
      // this as `number | string`, so the cast below is type-legal.
      const map = buildSitesById([
        { ...site('a', 0, 0), latitude: '12.34' as unknown as number, longitude: '-56.78' as unknown as number },
      ])
      expect(map.get('a')).toEqual({ lat: 12.34, lng: -56.78 })
    })

    it('skips sites with non-numeric coords', () => {
      const map = buildSitesById([
        { ...site('a', 0, 0), latitude: 'not-a-number' as unknown as number, longitude: 0 },
      ])
      expect(map.has('a')).toBe(false)
    })
  })

  describe('resolvePulseLocation', () => {
    const sitesById = buildSitesById([site('s1', 10, 20), site('s2', 30, 40)])

    it('resolves a Site event by entity_id', () => {
      const e = event({ entity_type: 'Site', entity_id: 's1' })
      expect(resolvePulseLocation(e, sitesById)).toEqual({ lat: 10, lng: 20 })
    })

    it('resolves an Incident event via after_snapshot.site_id', () => {
      const e = event({
        entity_type: 'Incident',
        entity_id: 'incident-1',
        after_snapshot: { site_id: 's2' },
      })
      expect(resolvePulseLocation(e, sitesById)).toEqual({ lat: 30, lng: 40 })
    })

    it('falls back to before_snapshot.site_id when after_snapshot is empty', () => {
      const e = event({
        entity_type: 'Task',
        entity_id: 'task-1',
        after_snapshot: {},
        before_snapshot: { site_id: 's1' },
      })
      expect(resolvePulseLocation(e, sitesById)).toEqual({ lat: 10, lng: 20 })
    })

    it('returns null when no site_id is extractable', () => {
      const e = event({
        entity_type: 'Recommendation',
        entity_id: 'rec-1',
        after_snapshot: {},
      })
      expect(resolvePulseLocation(e, sitesById)).toBeNull()
    })

    it('returns null when site_id points to an unknown site (out of org scope)', () => {
      const e = event({ entity_type: 'Site', entity_id: 'unknown-site' })
      expect(resolvePulseLocation(e, sitesById)).toBeNull()
    })
  })

  describe('buildPulses', () => {
    const sitesById = buildSitesById([site('s1', 10, 20)])

    it('filters to high-signal event types only', () => {
      const events = [
        event({ id: '1', event_type: 'site_flagged', occurred_at: ASOF }),
        // Not in HIGH_SIGNAL list — should be dropped
        event({ id: '2', event_type: 'site_status_changed', occurred_at: ASOF }),
      ]
      const pulses = buildPulses(events, sitesById, ASOF_MS)
      expect(pulses.map(p => p.id)).toEqual(['1'])
    })

    it('drops events more than PULSE_WINDOW_MS before the cursor', () => {
      const insideMs = ASOF_MS - PULSE_WINDOW_MS + 60_000 // 1min inside the past edge
      const outsideMs = ASOF_MS - PULSE_WINDOW_MS - 60_000 // 1min past the past edge
      const events = [
        event({ id: 'in', occurred_at: new Date(insideMs).toISOString() }),
        event({ id: 'out', occurred_at: new Date(outsideMs).toISOString() }),
      ]
      const pulses = buildPulses(events, sitesById, ASOF_MS)
      expect(pulses.map(p => p.id)).toEqual(['in'])
    })

    it('drops events ahead of the cursor regardless of distance', () => {
      // Cinematic past-only narrative — events that have not happened yet
      // in the replay timeline must not pulse, even if very close to the
      // cursor. The hook's epoch-bucketed fetch deliberately loads a
      // forward-extending window for caching, so this client-side filter
      // is the one that enforces the cursor's "what has happened" semantics.
      const closeFutureMs = ASOF_MS + 30_000 // 30s in the future (well within ±5min)
      const farFutureMs = ASOF_MS + PULSE_WINDOW_MS - 1
      const events = [
        event({ id: 'close-future', occurred_at: new Date(closeFutureMs).toISOString() }),
        event({ id: 'far-future', occurred_at: new Date(farFutureMs).toISOString() }),
      ]
      const pulses = buildPulses(events, sitesById, ASOF_MS)
      expect(pulses).toEqual([])
    })

    it('assigns intensity 1.0 at the cursor and 0 at the past-edge', () => {
      const events = [
        event({ id: 'at-cursor', occurred_at: ASOF }),
        event({
          id: 'at-edge',
          occurred_at: new Date(ASOF_MS - PULSE_WINDOW_MS).toISOString(),
        }),
      ]
      const pulses = buildPulses(events, sitesById, ASOF_MS)
      const byId = new Map(pulses.map(p => [p.id, p]))
      expect(byId.get('at-cursor')?.intensity).toBe(1)
      expect(byId.get('at-edge')?.intensity).toBe(0)
    })

    it('caps at MAX_PULSES, keeping the highest-intensity entries', () => {
      const events: AuditEvent[] = []
      for (let i = 0; i < MAX_PULSES + 20; i++) {
        // Spread occurredAt linearly across the window so intensities differ
        const offsetMs = (i / (MAX_PULSES + 20)) * PULSE_WINDOW_MS
        events.push(event({
          id: `e-${i}`,
          occurred_at: new Date(ASOF_MS - offsetMs).toISOString(),
        }))
      }
      const pulses = buildPulses(events, sitesById, ASOF_MS)
      expect(pulses).toHaveLength(MAX_PULSES)
      // First entry should be the cursor-closest (highest intensity)
      expect(pulses[0]?.id).toBe('e-0')
    })

    it('drops events for sites not in the loaded map (e.g. cross-org)', () => {
      const events = [
        event({ id: 'visible', entity_type: 'Site', entity_id: 's1' }),
        event({ id: 'foreign', entity_type: 'Site', entity_id: 's-foreign' }),
      ]
      const pulses = buildPulses(events, sitesById, ASOF_MS)
      expect(pulses.map(p => p.id)).toEqual(['visible'])
    })
  })

  describe('HIGH_SIGNAL_PULSE_EVENT_TYPES', () => {
    it('contains the load-bearing demo events', () => {
      // Lock in the contract — if these change, MapOverlayControls
      // legend hints + PULSE_COLORS must change with them.
      expect([...HIGH_SIGNAL_PULSE_EVENT_TYPES]).toEqual([
        'site_flagged',
        'incident.opened',
        'incident_transitioned',
        'task.transitioned',
        'prosecution_started',
      ])
    })
  })
})
