/**
 * MapLibre source/layer wiring for the Tranche 6-A replay event pulses.
 *
 * Two layers stacked on the same GeoJSON source:
 *   1. `replay-pulse-halo`   — large semi-transparent breathing halo
 *   2. `replay-pulse-core`   — small solid core dot
 *
 * Per-event color comes from PULSE_COLORS via a `match` expression on
 * the `eventType` feature property. Halo radius is multiplied by
 * `breath` (a 0..1 cycle driven from the engine sub-hook), so all
 * pulses pulse together — operator perception is "this thing is
 * alive at this moment in the timeline."
 *
 * Source id is `replay-pulses`, layer ids are exported so callers can
 * remove them on cleanup or order them above other layers.
 */

import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type { Pulse } from './replayEventPulses'
import { PULSE_COLORS } from './replayEventPulses'

export const REPLAY_PULSE_SOURCE_ID = 'replay-pulses'
export const REPLAY_PULSE_HALO_LAYER_ID = 'replay-pulse-halo'
export const REPLAY_PULSE_CORE_LAYER_ID = 'replay-pulse-core'

const REPLAY_PULSE_LAYER_IDS = [REPLAY_PULSE_HALO_LAYER_ID, REPLAY_PULSE_CORE_LAYER_ID] as const

function buildFeatureCollection(pulses: readonly Pulse[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pulses.map((pulse) => ({
      type: 'Feature',
      id: pulse.id,
      geometry: {
        type: 'Point',
        coordinates: [pulse.lng, pulse.lat],
      },
      properties: {
        id: pulse.id,
        eventType: pulse.eventType,
        intensity: pulse.intensity,
        occurredAt: pulse.occurredAt,
      },
    })),
  }
}

/**
 * Color match expression — keeps event-type → color in lock-step with
 * the legend in MapOverlayControls because both consume PULSE_COLORS.
 */
function buildColorExpression(): ExpressionSpecification {
  return [
    'match', ['get', 'eventType'],
    'site_flagged',          PULSE_COLORS.site_flagged,
    'incident.opened',       PULSE_COLORS['incident.opened'],
    'incident_transitioned', PULSE_COLORS.incident_transitioned,
    'task.transitioned',     PULSE_COLORS['task.transitioned'],
    'prosecution_started',   PULSE_COLORS.prosecution_started,
    '#ffffff',
  ]
}

export function ensureReplayPulseLayers(map: MapLibreMap, pulses: readonly Pulse[]): void {
  if (!map.getSource(REPLAY_PULSE_SOURCE_ID)) {
    map.addSource(REPLAY_PULSE_SOURCE_ID, {
      type: 'geojson',
      data: buildFeatureCollection(pulses),
    })
  }

  if (!map.getLayer(REPLAY_PULSE_HALO_LAYER_ID)) {
    map.addLayer({
      id: REPLAY_PULSE_HALO_LAYER_ID,
      type: 'circle',
      source: REPLAY_PULSE_SOURCE_ID,
      paint: {
        // Halo radius scales with intensity (proximity to cursor) AND breath
        // (animation frame). 6px floor so even fading pulses stay legible;
        // 26px ceiling so we never blow up over a dense cluster.
        'circle-radius': [
          '+',
          6,
          ['*', 20, ['get', 'intensity'], ['coalesce', ['feature-state', 'breath'], 0.6]],
        ],
        'circle-color': buildColorExpression(),
        'circle-opacity': ['*', 0.32, ['get', 'intensity']],
        'circle-blur': 0.6,
        'circle-stroke-color': buildColorExpression(),
        'circle-stroke-width': 0,
      },
    })
  }

  if (!map.getLayer(REPLAY_PULSE_CORE_LAYER_ID)) {
    map.addLayer({
      id: REPLAY_PULSE_CORE_LAYER_ID,
      type: 'circle',
      source: REPLAY_PULSE_SOURCE_ID,
      paint: {
        'circle-radius': ['+', 3, ['*', 4, ['get', 'intensity']]],
        'circle-color': buildColorExpression(),
        'circle-opacity': ['*', 0.95, ['get', 'intensity']],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
        'circle-stroke-opacity': ['*', 0.8, ['get', 'intensity']],
      },
    })
  }
}

export function updateReplayPulseSources(map: MapLibreMap, pulses: readonly Pulse[]): void {
  const source = map.getSource(REPLAY_PULSE_SOURCE_ID) as GeoJSONSource | undefined
  if (!source) return
  source.setData(buildFeatureCollection(pulses))
}

/**
 * Drive the breathing halo. Sets `breath` feature-state on every
 * current pulse to a 0..1 cycle. Cheap: one O(n) pass per RAF tick
 * with n ≤ MAX_PULSES (50) — well under any per-frame budget.
 *
 * `breath` is read by the halo paint expression's circle-radius via
 * `feature-state`. Returns the next-frame value so the caller can
 * optimise idle ticks if it ever wants to (current implementation
 * just runs while the layer is mounted).
 */
export function applyReplayPulseBreath(
  map: MapLibreMap,
  pulses: readonly Pulse[],
  phase: number,
): void {
  if (!map.getSource(REPLAY_PULSE_SOURCE_ID)) return
  // Sinusoidal breath — slow, ~2s period at 60fps with phase step 0.05.
  const breath = 0.5 + 0.5 * Math.sin(phase)
  for (const pulse of pulses) {
    map.setFeatureState(
      { source: REPLAY_PULSE_SOURCE_ID, id: pulse.id },
      { breath },
    )
  }
}

export function removeReplayPulseLayers(map: MapLibreMap): void {
  for (const layerId of REPLAY_PULSE_LAYER_IDS) {
    if (map.getLayer(layerId)) map.removeLayer(layerId)
  }
  if (map.getSource(REPLAY_PULSE_SOURCE_ID)) {
    map.removeSource(REPLAY_PULSE_SOURCE_ID)
  }
}
