import { formatBearingLineDegrees } from '../../../lib/mapBearingLine'
import { formatSectorArcDegrees, formatSectorDegrees } from '../../../lib/mapSectorOverlay'
import {
  measurementBearingCardinal,
  measurementBearingDegrees,
  measurementDistanceKm,
} from '../../../lib/mapMeasurement'
import { formatRangeRingInputValue, type RangeRingUnit } from '../../../lib/mapRangeRings'
import type { MapPoint } from '../../../lib/mapPoint'

export function formatPoint(point: MapPoint): string {
  return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`
}

export type MeasurementSummary = {
  anchor: MapPoint | null
  target: MapPoint | null
  distanceKm: number | null
  distanceNm: number | null
  bearingDegrees: number | null
  bearingLabel: string | null
}

export function computeMeasurementSummary(measurementPoints: MapPoint[]): MeasurementSummary {
  const anchor = measurementPoints[0] ?? null
  const target = measurementPoints[1] ?? null
  const distanceKm = anchor && target ? measurementDistanceKm(anchor, target) : null
  const distanceNm = distanceKm === null ? null : distanceKm / 1.852
  const bearingDegrees = anchor && target ? measurementBearingDegrees(anchor, target) : null
  const bearingLabel = bearingDegrees === null ? null : measurementBearingCardinal(bearingDegrees)
  return { anchor, target, distanceKm, distanceNm, bearingDegrees, bearingLabel }
}

export type SectorSummary = {
  heading: string | null
  cardinal: string | null
  arcLabel: string | null
  distanceLabel: string | null
}

export function computeSectorSummary(
  sectorDegrees: number | null,
  sectorArcDegrees: number | null,
  sectorDistanceKm: number | null,
  sectorUnit: RangeRingUnit,
): SectorSummary {
  return {
    heading: sectorDegrees === null ? null : formatSectorDegrees(sectorDegrees),
    cardinal: sectorDegrees === null ? null : measurementBearingCardinal(sectorDegrees),
    arcLabel: sectorArcDegrees === null ? null : formatSectorArcDegrees(sectorArcDegrees),
    distanceLabel: sectorDistanceKm === null
      ? null
      : `${formatRangeRingInputValue(sectorDistanceKm, sectorUnit)} ${sectorUnit.toUpperCase()}`,
  }
}

export type BearingLineSummary = {
  heading: string | null
  cardinal: string | null
  distanceLabel: string | null
}

export function computeBearingLineSummary(
  bearingLineDegrees: number | null,
  bearingLineDistanceKm: number | null,
  bearingLineUnit: RangeRingUnit,
): BearingLineSummary {
  return {
    heading: bearingLineDegrees === null ? null : formatBearingLineDegrees(bearingLineDegrees),
    cardinal: bearingLineDegrees === null ? null : measurementBearingCardinal(bearingLineDegrees),
    distanceLabel: bearingLineDistanceKm === null
      ? null
      : `${formatRangeRingInputValue(bearingLineDistanceKm, bearingLineUnit)} ${bearingLineUnit.toUpperCase()}`,
  }
}
