import type { IconName } from '@blueprintjs/icons'

/**
 * Maps signal_type → Blueprint icon name.
 * Used in JSX contexts where <Icon> can be rendered.
 * For raw HTML string contexts (MapLibre popups), use SIGNAL_ICON_CHAR instead.
 */
export const SIGNAL_ICON_NAME: Record<string, IconName> = {
  aircraft_position: 'airplane',
  vessel_position:   'ship',
  seismic_event:     'waves',
  gps_jamming:       'satellite',
  wildfire:          'flame',
  ais_gap:           'eye-off',
  conflict_event:    'warning-sign',
  manual:            'manually-entered-data',
}

/**
 * Unicode characters for canvas/WebGL rendering contexts:
 * - MapLibre symbol layer text-field expressions
 * - Cesium label entities
 * - MapLibre hover popup setHTML strings
 * Characters chosen for broad font coverage in system fonts.
 */
export const SIGNAL_ICON_CHAR: Record<string, string> = {
  aircraft_position: '✈',   // U+2708 AIRPLANE
  vessel_position:   '⚓',   // U+2693 ANCHOR
  seismic_event:     '≈',   // U+2248 ALMOST EQUAL (wave-like, universal)
  gps_jamming:       '⊗',   // U+2297 CIRCLED TIMES (disruption)
  wildfire:          '△',   // U+25B3 WHITE TRIANGLE (flame silhouette)
  ais_gap:           '⊙',   // U+2299 CIRCLED DOT (eye-like, vessel went dark)
  conflict_event:    '⚔',   // U+2694 CROSSED SWORDS (armed conflict)
  manual:            '+',   // U+002B PLUS (injected manually)
}
