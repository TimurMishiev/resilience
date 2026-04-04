/**
 * useMapTrackLayers
 *
 * Manages MapLibre GeoJSON sources + layers for vessel track polyline
 * and asset trail polylines. Extracted from useMapLibreEngine.
 */

import { useEffect } from 'react'
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl'
import type { VesselTrack } from '../../api/vessels'
import { ASSET_STATUS_COLORS, SIGNAL_COLORS } from '../../lib/signalConfig'
import type { AssetTrail } from '../../lib/telemetry'

export interface MapTrackLayersInput {
  mapRef:       React.RefObject<MapLibreMap | null>
  mapLoaded:    boolean
  vesselTracks: VesselTrack[]
  assetTrails:  AssetTrail[]
  showTrails:   boolean
}

export function useMapTrackLayers({
  mapRef,
  mapLoaded,
  vesselTracks,
  assetTrails,
  showTrails,
}: MapTrackLayersInput): void {
  // Vessel track polyline
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    if (map.getLayer('vessel-track-line')) map.removeLayer('vessel-track-line')
    if (map.getSource('vessel-track'))     map.removeSource('vessel-track')

    if (vesselTracks.length < 2) return

    const coords = vesselTracks.map(t => [Number(t.lng), Number(t.lat)])
    map.addSource('vessel-track', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
    })
    map.addLayer({
      id: 'vessel-track-line', type: 'line', source: 'vessel-track',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color':     SIGNAL_COLORS.vessel_position,
        'line-width':     2.5,
        'line-opacity':   0.80,
        'line-dasharray': [4, 3],
      },
    }, 'signal-glow')
  }, [mapLoaded, vesselTracks, mapRef])

  // Asset trails — one LineString per asset
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const featureCollection = {
      type: 'FeatureCollection' as const,
      features: assetTrails
        .filter(trail => trail.points.length >= 2)
        .map(trail => ({
          type: 'Feature' as const,
          properties: { status: trail.status, name: trail.name },
          geometry: {
            type: 'LineString' as const,
            coordinates: trail.points.map(p => [p.lng, p.lat]),
          },
        })),
    }

    const existingSource = map.getSource('asset-trails') as GeoJSONSource | undefined
    if (existingSource) {
      if (featureCollection.features.length === 0) {
        if (map.getLayer('asset-trail-line')) map.removeLayer('asset-trail-line')
        map.removeSource('asset-trails')
      } else {
        existingSource.setData(featureCollection)
      }
      return
    }

    if (featureCollection.features.length === 0) return

    map.addSource('asset-trails', { type: 'geojson', data: featureCollection })
    map.addLayer({
      id: 'asset-trail-line',
      type: 'line',
      source: 'asset-trails',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'status'],
          'available', ASSET_STATUS_COLORS['available'],
          'assigned',  ASSET_STATUS_COLORS['assigned'],
          'degraded',  ASSET_STATUS_COLORS['degraded'],
          ASSET_STATUS_COLORS['offline'],
        ],
        'line-width':  2,
        'line-opacity': 0.7,
      },
    }, 'signal-glow')
  }, [mapLoaded, assetTrails, mapRef])

  // Asset trail visibility toggle
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (!map.getLayer('asset-trail-line')) return
    map.setLayoutProperty('asset-trail-line', 'visibility', showTrails ? 'visible' : 'none')
  }, [mapLoaded, showTrails, mapRef])
}
