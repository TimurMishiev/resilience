/**
 * useMapConfidenceHaloLayers
 *
 * Tranche 6-D-map: replay-only confidence halos for active alerts.
 *
 * Renders one circle per site whose `SignalRuleMatch` rows currently include
 * at least one non-closed match, with the per-site **max confidence** driving
 * the layer opacity. Replay-only and always on (no toggle).
 *
 * Data source: the unpaginated `/api/signal_rule_matches/active_site_confidence`
 * endpoint via [useActiveSiteConfidence](../../hooks/useActiveSiteConfidence.ts).
 * The reduction `site_id -> max(confidence)` is performed server-side; this
 * hook receives the raw summaries and drops rows whose site is absent from
 * the current map dataset (surface-specific concern — globe must reuse the
 * same raw feed).
 *
 * Layer order: anchored below `site-circles` via MapLibre `beforeLayer` so
 * the halo reads as an affordance, not the site itself, regardless of any
 * future hook ordering inside `useMapLibreEngine`.
 *
 * Visual contract:
 *   - point source + `circle` layer (NOT polygon/fill)
 *   - fixed radius, single amber family
 *   - opacity ramp: 0.25 + 0.55 * confidence (confidence ∈ [0, 1])
 *   - geometry stable; only opacity varies with confidence
 */

import { useEffect } from 'react'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type { Site } from '../../api/types'
import type { ActiveSiteConfidence } from '../../api/signal_rule_matches'

export interface MapConfidenceHaloLayersInput {
  mapRef:    React.RefObject<MapLibreMap | null>
  mapLoaded: boolean

  sites:       Site[]
  summaries:   ActiveSiteConfidence[]
  isReplaying: boolean
}

export const CONFIDENCE_HALO_SOURCE_ID = 'confidence-halos'
export const CONFIDENCE_HALO_LAYER_ID  = 'confidence-halo'
export const CONFIDENCE_HALO_BEFORE_LAYER = 'site-circles'

export function useMapConfidenceHaloLayers({
  mapRef,
  mapLoaded,
  sites,
  summaries,
  isReplaying,
}: MapConfidenceHaloLayersInput): void {
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const features: GeoJSON.Feature<GeoJSON.Point, { confidence: number; site_id: string }>[] =
      isReplaying
        ? buildHaloFeatures(summaries, sites)
        : []

    const data: GeoJSON.FeatureCollection<GeoJSON.Point, { confidence: number; site_id: string }> = {
      type: 'FeatureCollection',
      features,
    }

    const source = map.getSource(CONFIDENCE_HALO_SOURCE_ID) as GeoJSONSource | undefined
    if (source) {
      source.setData(data)
      return
    }

    map.addSource(CONFIDENCE_HALO_SOURCE_ID, { type: 'geojson', data })

    const beforeLayer = map.getLayer(CONFIDENCE_HALO_BEFORE_LAYER)
      ? CONFIDENCE_HALO_BEFORE_LAYER
      : undefined

    map.addLayer(
      {
        id:     CONFIDENCE_HALO_LAYER_ID,
        type:   'circle',
        source: CONFIDENCE_HALO_SOURCE_ID,
        paint: {
          'circle-radius':       14,
          'circle-color':        '#f59f00',
          'circle-stroke-color': '#f59f00',
          'circle-stroke-width': 1.5,
          'circle-opacity': [
            'interpolate', ['linear'], ['get', 'confidence'],
            0, 0.25,
            1, 0.80,
          ],
          'circle-stroke-opacity': [
            'interpolate', ['linear'], ['get', 'confidence'],
            0, 0.40,
            1, 0.95,
          ],
        },
      },
      beforeLayer,
    )
  }, [mapRef, mapLoaded, sites, summaries, isReplaying])
}

function buildHaloFeatures(
  summaries: ActiveSiteConfidence[],
  sites: Site[],
): GeoJSON.Feature<GeoJSON.Point, { confidence: number; site_id: string }>[] {
  const siteById = new Map<string, Site>(sites.map((s) => [s.id, s]))
  const features: GeoJSON.Feature<GeoJSON.Point, { confidence: number; site_id: string }>[] = []

  for (const summary of summaries) {
    const site = siteById.get(summary.site_id)
    // Drop rows whose site is absent from the current replay dataset; the
    // halo cannot anchor anywhere meaningful without the site coordinates.
    if (!site) continue

    features.push({
      type: 'Feature',
      properties: {
        site_id:    summary.site_id,
        confidence: clampConfidence(summary.confidence),
      },
      geometry: {
        type:        'Point',
        coordinates: [Number(site.longitude), Number(site.latitude)],
      },
    })
  }

  return features
}

function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}
