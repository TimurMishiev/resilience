import type { Signal } from '../api/types'
import { deriveFreshness, type FreshnessThresholds } from './freshness'

const SIGNAL_MAP_FRESHNESS_THRESHOLDS: FreshnessThresholds = {
  agingMs: 2 * 3_600_000,
  staleMs: 12 * 3_600_000,
}

function buildMapSignalFeature(signal: Signal, referenceTimeMs: number): GeoJSON.Feature {
  const occurredAtMs = Date.parse(signal.occurred_at)
  const freshness =
    Number.isFinite(occurredAtMs)
      ? deriveFreshness(occurredAtMs, referenceTimeMs, SIGNAL_MAP_FRESHNESS_THRESHOLDS)
      : 'unavailable'

  return {
    type: 'Feature',
    properties: {
      id: signal.id,
      signal_type: signal.signal_type,
      source: signal.source,
      magnitude: signal.magnitude,
      altitude: signal.altitude,
      speed: signal.speed,
      heading: signal.heading,
      occurred_at: signal.occurred_at,
      freshness,
      p_country: (signal.raw_payload.country as string | undefined) ?? null,
      p_actor1: (signal.raw_payload.actor1 as string | undefined) ?? null,
      p_fatalities: (signal.raw_payload.fatalities as number | undefined) ?? null,
      p_event_type: (signal.raw_payload.event_type as string | undefined) ?? null,
      p_event_type_name: (signal.raw_payload.event_type_name as string | undefined) ?? null,
      p_alert_level: (signal.raw_payload.alert_level as string | undefined) ?? null,
      p_severity_text: (signal.raw_payload.severity_text as string | undefined) ?? null,
      p_name: (signal.raw_payload.name as string | undefined) ?? null,
    },
    geometry: {
      type: 'Point',
      coordinates: [Number(signal.lng), Number(signal.lat)],
    },
  }
}

export function buildMapSignalFeatureCollection(signals: Signal[], referenceTimeMs = Date.now()): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: signals.map(s => buildMapSignalFeature(s, referenceTimeMs)),
  }
}

export function buildMapSignalRenderCollections(
  signals: Signal[],
  selectedSignalId: string | null,
  referenceTimeMs = Date.now(),
): {
  clusterable: GeoJSON.FeatureCollection
  selected: GeoJSON.FeatureCollection
} {
  const clusterableFeatures: GeoJSON.Feature[] = []
  let selectedFeature: GeoJSON.Feature | null = null

  for (const signal of signals) {
    const feature = buildMapSignalFeature(signal, referenceTimeMs)

    if (selectedSignalId && signal.id === selectedSignalId && selectedFeature === null) {
      selectedFeature = feature
      continue
    }

    clusterableFeatures.push(feature)
  }

  return {
    clusterable: {
      type: 'FeatureCollection',
      features: clusterableFeatures,
    },
    selected: {
      type: 'FeatureCollection',
      features: selectedFeature ? [selectedFeature] : [],
    },
  }
}
