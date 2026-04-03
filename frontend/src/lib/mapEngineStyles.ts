import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl'
import { SIGNAL_COLORS } from './signalConfig'

export type MapStyleKey = 'tactical' | 'satellite' | 'street'

const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'esri-imagery': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '© Esri, Maxar, Earthstar Geographics',
      maxzoom: 18,
    },
    'esri-labels': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 18,
    },
  },
  layers: [
    { id: 'imagery', type: 'raster', source: 'esri-imagery' },
    { id: 'labels', type: 'raster', source: 'esri-labels', paint: { 'raster-opacity': 0.85 } },
  ],
}

export const MAP_STYLE_CONFIGS: Record<MapStyleKey, { label: string; style: string | StyleSpecification }> = {
  tactical: { label: 'Tactical', style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' },
  satellite: { label: 'Satellite', style: SATELLITE_STYLE },
  street: { label: 'Street', style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json' },
}

export function signalColorExpression(): ExpressionSpecification {
  return [
    'match', ['get', 'signal_type'],
    'aircraft_position', SIGNAL_COLORS.aircraft_position,
    'vessel_position', SIGNAL_COLORS.vessel_position,
    'seismic_event', SIGNAL_COLORS.seismic_event,
    'gps_jamming', SIGNAL_COLORS.gps_jamming,
    'wildfire', SIGNAL_COLORS.wildfire,
    'ais_gap', SIGNAL_COLORS.ais_gap,
    'conflict_event', SIGNAL_COLORS.conflict_event,
    'disaster_alert', SIGNAL_COLORS.disaster_alert,
    SIGNAL_COLORS.manual,
  ]
}

export function signalGlowRadiusExpression(): ExpressionSpecification {
  return ['match', ['get', 'signal_type'], 'seismic_event', 18, 'wildfire', 16, 12]
}

export function signalCircleRadiusExpression(): ExpressionSpecification {
  return ['match', ['get', 'signal_type'], 'seismic_event', 8, 'wildfire', 7, 5]
}

export function selectedSignalRingRadiusExpression(): ExpressionSpecification {
  return ['match', ['get', 'signal_type'], 'seismic_event', 14, 'wildfire', 13, 11]
}

export function signalSymbolExpression(): ExpressionSpecification {
  return ['match', ['get', 'signal_type'],
    'aircraft_position', '✈',
    'vessel_position', '⚓',
    'seismic_event', '≈',
    'gps_jamming', '⊗',
    'wildfire', '△',
    'ais_gap', '⊙',
    'manual', '+',
    '●',
  ]
}
