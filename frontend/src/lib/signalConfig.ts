/**
 * Signal type display config shared by MapPage, GlobePage, and all inspector
 * components. CSS hex colors (no Cesium or MapLibre dependency) so any file
 * can import this safely.
 */

export const SIGNAL_COLORS: Record<string, string> = {
  aircraft_position: '#00d4ff',
  vessel_position:   '#00c4a0',
  seismic_event:     '#ff8c42',
  gps_jamming:       '#ffd700',
  wildfire:          '#ff4422',
  ais_gap:           '#f7f9fb',
  conflict_event:    '#e040fb',
  disaster_alert:    '#ff4081',
  manual:            '#8f99a8',
}

export const SIGNAL_LABELS: Record<string, string> = {
  aircraft_position: 'Aircraft',
  vessel_position:   'Vessel',
  seismic_event:     'Seismic',
  gps_jamming:       'GPS Jam',
  wildfire:          'Wildfire',
  ais_gap:           'AIS Gap',
  conflict_event:    'Conflict',
  disaster_alert:    'Disaster',
  manual:            'Manual',
}

export const ASSET_STATUS_COLORS: Record<string, string> = {
  available: '#3ddc84',
  assigned:  '#5282ff',
  degraded:  '#ffb366',
  offline:   '#8f99a8',
}

export const SOURCE_LABELS: Record<string, string> = {
  opensky:        'OpenSky',
  ais:            'AIS',
  usgs_seismic:   'USGS Seismic',
  gpsjam:         'GPSJam',
  firms_wildfire: 'FIRMS Wildfire',
  acled:          'ACLED',
  gdacs:          'GDACS',
  manual:         'Manual',
  derived:        'Derived',
}

export const ALERT_LEVEL_INTENT: Record<string, 'success' | 'warning' | 'danger'> = {
  Green:  'success',
  Orange: 'warning',
  Red:    'danger',
}
