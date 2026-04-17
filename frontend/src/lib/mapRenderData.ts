import type { Asset, Site, Task } from '../api/types'
import { deriveFreshness, type FreshnessThresholds } from './freshness'
import { assetDisplayPosition } from './assetPresentation'
import { SIGNAL_ICON_CHAR } from './signalIcons'
import { SOURCE_LABELS, SIGNAL_COLORS, SIGNAL_LABELS } from './signalConfig'
import type { TelemetryMap } from './telemetry'

const ASSET_MAP_FRESHNESS_THRESHOLDS: FreshnessThresholds = {
  agingMs: 6 * 3_600_000,
  staleMs: 24 * 3_600_000,
}

function assetTypeIcon(type: Asset['asset_type']): string {
  switch (type) {
    // Keep map labels in the ASCII range so third-party glyph CDNs are never
    // asked for emoji/astral-plane font blocks that can fail CORS in dev.
    case 'vehicle':   return 'V'
    case 'equipment': return 'E'
    case 'personnel': return 'P'
    default:          return '?'
  }
}

export function siteHealthKey(tasks: Task[], siteStatus: Site['status']): string {
  if (siteStatus === 'inactive') return 'inactive'
  if (tasks.length === 0)        return 'active'
  const hasBlocked = tasks.some(t => t.workflow_status === 'blocked')
  const allResolved = tasks.every(t => t.workflow_status === 'resolved')
  const hasInProgress = tasks.some(t => t.workflow_status === 'in_progress')
  if (hasBlocked) return 'blocked'
  if (allResolved) return 'resolved'
  if (hasInProgress) return 'in_progress'
  return 'active'
}

export function siteHealthColor(health: string): string {
  switch (health) {
    case 'blocked': return '#ff5c5c'
    case 'resolved': return '#2fd46b'
    case 'in_progress': return '#35a7ff'
    case 'inactive': return '#6b7280'
    default: return '#2fd46b'
  }
}

function appendPopupRow(container: HTMLElement, label: string, value: string, valueColor?: string) {
  const row = document.createElement('span')
  row.className = 'sp-row'
  const labelEl = document.createElement('span')
  labelEl.textContent = label
  const valueEl = document.createElement('b')
  valueEl.textContent = value
  if (valueColor) valueEl.style.color = valueColor
  row.append(labelEl, valueEl)
  container.appendChild(row)
}

export function buildSignalPopupContent(props: Record<string, string>) {
  const root = document.createElement('div')
  root.className = 'signal-popup'

  const header = document.createElement('div')
  header.className = 'sp-header'
  header.style.borderLeft = `3px solid ${SIGNAL_COLORS[props.signal_type] ?? '#8f99a8'}`

  const icon = document.createElement('span')
  icon.className = 'sp-icon'
  icon.textContent = SIGNAL_ICON_CHAR[props.signal_type] ?? '●'

  const type = document.createElement('span')
  type.className = 'sp-type'
  type.textContent =
    props.signal_type === 'disaster_alert' && props.p_name
      ? props.p_name
      : (SIGNAL_LABELS[props.signal_type] ?? props.signal_type)

  header.append(icon, type)

  const body = document.createElement('div')
  body.className = 'sp-body'

  appendPopupRow(body, 'Source', SOURCE_LABELS[props.source] ?? props.source)

  if (props.signal_type === 'conflict_event') {
    if (props.p_country) appendPopupRow(body, 'Country', props.p_country)
    if (props.p_actor1) appendPopupRow(body, 'Actor', props.p_actor1)
    if (props.p_fatalities != null) appendPopupRow(body, 'Fatalities', props.p_fatalities)
  } else if (props.signal_type === 'disaster_alert') {
    if (props.p_event_type_name) appendPopupRow(body, 'Type', props.p_event_type_name)
    if (props.p_country) appendPopupRow(body, 'Country', props.p_country)
    if (props.p_alert_level) {
      const alertColor =
        props.p_alert_level === 'Red' ? '#ff4444'
        : props.p_alert_level === 'Orange' ? '#ff9800'
        : '#4caf50'
      appendPopupRow(body, 'Alert', props.p_alert_level, alertColor)
    }
    if (props.p_severity_text) appendPopupRow(body, 'Severity', props.p_severity_text)
  } else {
    if (props.magnitude) appendPopupRow(body, 'Magnitude', Number(props.magnitude).toFixed(1))
    if (props.altitude) appendPopupRow(body, 'Altitude', `${Number(props.altitude).toFixed(0)} m`)
    if (props.speed) appendPopupRow(body, 'Speed', `${Number(props.speed).toFixed(0)} kn`)
  }

  if (props.occurred_at) {
    appendPopupRow(body, 'Time', new Date(props.occurred_at).toLocaleTimeString())
  }

  const hint = document.createElement('span')
  hint.className = 'sp-hint'
  hint.textContent = 'Click for details'
  body.appendChild(hint)

  root.append(header, body)
  return root
}

export function buildSiteFeatureCollection(
  sites: Site[],
  tasksBySite: Record<string, Task[]>,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: sites.map(site => {
      const health = siteHealthKey(tasksBySite[site.id] ?? [], site.status)
      return {
        type: 'Feature' as const,
        properties: {
          id: site.id,
          name: site.name,
          health,
          color: siteHealthColor(health),
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [Number(site.longitude), Number(site.latitude)],
        },
      }
    }),
  }
}

export function buildAssetFeatureCollection(
  assets: Asset[],
  sites: Site[],
  readings: TelemetryMap,
  allowHistoricalTelemetry = false,
  referenceTimeMs = Date.now(),
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: assets.map(asset => {
      const { lat, lng } = assetDisplayPosition(
        asset,
        sites,
        readings,
        { lat: 37.7749, lng: -122.4194 },
        { allowHistorical: allowHistoricalTelemetry },
      )
      const timestamp = asset.last_reported_at ?? asset.updated_at
      const updatedAtMs = Date.parse(timestamp)
      const freshness =
        Number.isFinite(updatedAtMs)
          ? deriveFreshness(updatedAtMs, referenceTimeMs, ASSET_MAP_FRESHNESS_THRESHOLDS)
          : 'unavailable'
      return {
        type: 'Feature' as const,
        properties: {
          id: asset.id,
          name: asset.name,
          asset_type: asset.asset_type,
          status: asset.status,
          home_site_id: asset.home_site_id ?? '',
          freshness,
          icon: assetTypeIcon(asset.asset_type),
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [lng, lat],
        },
      }
    }),
  }
}
