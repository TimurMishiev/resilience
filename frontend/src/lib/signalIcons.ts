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
  manual:            'manually-entered-data',
}

/**
 * Plain unicode/text fallbacks for HTML string contexts (e.g. MapLibre setHTML).
 */
export const SIGNAL_ICON_CHAR: Record<string, string> = {
  aircraft_position: '✈',
  vessel_position:   '⚓',
  seismic_event:     '≋',
  gps_jamming:       '◌',
  wildfire:          '▲',
  ais_gap:           '◎',
  manual:            '◆',
}
