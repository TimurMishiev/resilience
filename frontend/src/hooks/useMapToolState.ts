import { useCallback, useMemo, useRef, useState } from 'react'
import {
  convertRangeRingInputValue,
  DEFAULT_RANGE_RING_INPUTS,
  DEFAULT_RANGE_RING_UNIT,
  parseRangeRingInputs,
  type RangeRingUnit,
} from '../lib/mapRangeRings'
import {
  DEFAULT_SECTOR_ARC_INPUT,
  DEFAULT_SECTOR_DEGREES_INPUT,
  DEFAULT_SECTOR_DISTANCE_INPUT,
  parseSectorArcDegrees,
  parseSectorDegrees,
  parseSectorDistanceKm,
} from '../lib/mapSectorOverlay'
import {
  DEFAULT_BEARING_LINE_DEGREES_INPUT,
  DEFAULT_BEARING_LINE_DISTANCE_INPUT,
  parseBearingLineDegrees,
  parseBearingLineDistanceKm,
} from '../lib/mapBearingLine'
import type { MapPoint } from '../lib/mapPoint'
import type { MapAnnotation } from '../lib/mapAnnotations'

export function useMapToolState() {
  const [annotationMode, setAnnotationMode] = useState(false)
  const [annotations, setAnnotations] = useState<MapAnnotation[]>([])
  const [rangeRingMode, setRangeRingMode] = useState(false)
  const [rangeRingAnchor, setRangeRingAnchor] = useState<MapPoint | null>(null)
  const [rangeRingInputs, setRangeRingInputs] = useState<string[]>(() => [...DEFAULT_RANGE_RING_INPUTS])
  const [rangeRingUnit, setRangeRingUnit] = useState<RangeRingUnit>(DEFAULT_RANGE_RING_UNIT)
  const [sectorMode, setSectorMode] = useState(false)
  const [sectorAnchor, setSectorAnchor] = useState<MapPoint | null>(null)
  const [sectorDegreesInput, setSectorDegreesInput] = useState(DEFAULT_SECTOR_DEGREES_INPUT)
  const [sectorArcInput, setSectorArcInput] = useState(DEFAULT_SECTOR_ARC_INPUT)
  const [sectorDistanceInput, setSectorDistanceInput] = useState(DEFAULT_SECTOR_DISTANCE_INPUT)
  const [sectorUnit, setSectorUnit] = useState<RangeRingUnit>(DEFAULT_RANGE_RING_UNIT)
  const [bearingLineMode, setBearingLineMode] = useState(false)
  const [bearingLineAnchor, setBearingLineAnchor] = useState<MapPoint | null>(null)
  const [bearingLineDegreesInput, setBearingLineDegreesInput] = useState(DEFAULT_BEARING_LINE_DEGREES_INPUT)
  const [bearingLineDistanceInput, setBearingLineDistanceInput] = useState(DEFAULT_BEARING_LINE_DISTANCE_INPUT)
  const [bearingLineUnit, setBearingLineUnit] = useState<RangeRingUnit>(DEFAULT_RANGE_RING_UNIT)
  const [measurementMode, setMeasurementMode] = useState(false)
  const [measurementPoints, setMeasurementPoints] = useState<MapPoint[]>([])
  const nextAnnotationIdRef = useRef(1)

  const rangeRingRadiiKm = useMemo(
    () => parseRangeRingInputs(rangeRingInputs, rangeRingUnit),
    [rangeRingInputs, rangeRingUnit],
  )
  const sectorDegrees = useMemo(
    () => parseSectorDegrees(sectorDegreesInput),
    [sectorDegreesInput],
  )
  const sectorArcDegrees = useMemo(
    () => parseSectorArcDegrees(sectorArcInput),
    [sectorArcInput],
  )
  const sectorDistanceKm = useMemo(
    () => parseSectorDistanceKm(sectorDistanceInput, sectorUnit),
    [sectorDistanceInput, sectorUnit],
  )
  const bearingLineDegrees = useMemo(
    () => parseBearingLineDegrees(bearingLineDegreesInput),
    [bearingLineDegreesInput],
  )
  const bearingLineDistanceKm = useMemo(
    () => parseBearingLineDistanceKm(bearingLineDistanceInput, bearingLineUnit),
    [bearingLineDistanceInput, bearingLineUnit],
  )

  const clearMeasurement = useCallback(() => {
    setMeasurementPoints([])
  }, [])

  const clearAnnotations = useCallback(() => {
    nextAnnotationIdRef.current = 1
    setAnnotations([])
  }, [])

  const updateAnnotationLabel = useCallback((annotationId: string, label: string) => {
    setAnnotations(previous => previous.map(annotation => (
      annotation.id === annotationId ? { ...annotation, label } : annotation
    )))
  }, [])

  const removeAnnotation = useCallback((annotationId: string) => {
    setAnnotations(previous => previous.filter(annotation => annotation.id !== annotationId))
  }, [])

  const disableAnnotations = useCallback(() => {
    setAnnotationMode(false)
  }, [])

  const clearRangeRings = useCallback(() => {
    setRangeRingAnchor(null)
  }, [])

  const updateRangeRingInput = useCallback((index: number, value: string) => {
    setRangeRingInputs(previous => previous.map((input, inputIndex) => (
      inputIndex === index ? value : input
    )))
  }, [])

  const setRangeRingDisplayUnit = useCallback((nextUnit: RangeRingUnit) => {
    setRangeRingInputs(previous => previous.map(inputValue => (
      convertRangeRingInputValue(inputValue, rangeRingUnit, nextUnit)
    )))
    setRangeRingUnit(nextUnit)
  }, [rangeRingUnit])

  const disableRangeRings = useCallback(() => {
    setRangeRingMode(false)
  }, [])

  const clearSector = useCallback(() => {
    setSectorAnchor(null)
  }, [])

  const updateSectorDegreesInput = useCallback((value: string) => {
    setSectorDegreesInput(value)
  }, [])

  const updateSectorArcInput = useCallback((value: string) => {
    setSectorArcInput(value)
  }, [])

  const updateSectorDistanceInput = useCallback((value: string) => {
    setSectorDistanceInput(value)
  }, [])

  const setSectorDisplayUnit = useCallback((nextUnit: RangeRingUnit) => {
    setSectorDistanceInput(previous => convertRangeRingInputValue(previous, sectorUnit, nextUnit))
    setSectorUnit(nextUnit)
  }, [sectorUnit])

  const disableSector = useCallback(() => {
    setSectorMode(false)
  }, [])

  const clearBearingLine = useCallback(() => {
    setBearingLineAnchor(null)
  }, [])

  const updateBearingLineDegreesInput = useCallback((value: string) => {
    setBearingLineDegreesInput(value)
  }, [])

  const updateBearingLineDistanceInput = useCallback((value: string) => {
    setBearingLineDistanceInput(value)
  }, [])

  const setBearingLineDisplayUnit = useCallback((nextUnit: RangeRingUnit) => {
    setBearingLineDistanceInput(previous => (
      convertRangeRingInputValue(previous, bearingLineUnit, nextUnit)
    ))
    setBearingLineUnit(nextUnit)
  }, [bearingLineUnit])

  const disableBearingLine = useCallback(() => {
    setBearingLineMode(false)
  }, [])

  const disableMeasurement = useCallback(() => {
    setMeasurementMode(false)
    setMeasurementPoints([])
  }, [])

  const toggleMeasurement = useCallback(() => {
    if (measurementMode) {
      disableMeasurement()
      return
    }

    setMeasurementMode(true)
    setMeasurementPoints([])
    disableRangeRings()
    disableAnnotations()
    disableSector()
    disableBearingLine()
  }, [disableAnnotations, disableBearingLine, disableMeasurement, disableRangeRings, disableSector, measurementMode])

  const toggleAnnotations = useCallback(() => {
    if (annotationMode) {
      disableAnnotations()
      return
    }

    disableMeasurement()
    disableRangeRings()
    disableSector()
    disableBearingLine()
    setAnnotationMode(true)
  }, [annotationMode, disableAnnotations, disableBearingLine, disableMeasurement, disableRangeRings, disableSector])

  const toggleRangeRings = useCallback(() => {
    if (rangeRingMode) {
      disableRangeRings()
      return
    }

    disableMeasurement()
    disableAnnotations()
    disableSector()
    disableBearingLine()
    setRangeRingMode(true)
  }, [disableAnnotations, disableBearingLine, disableMeasurement, disableRangeRings, disableSector, rangeRingMode])

  const toggleSector = useCallback(() => {
    if (sectorMode) {
      disableSector()
      return
    }

    disableMeasurement()
    disableAnnotations()
    disableRangeRings()
    disableBearingLine()
    setSectorMode(true)
  }, [disableAnnotations, disableBearingLine, disableMeasurement, disableRangeRings, disableSector, sectorMode])

  const toggleBearingLine = useCallback(() => {
    if (bearingLineMode) {
      disableBearingLine()
      return
    }

    disableMeasurement()
    disableAnnotations()
    disableRangeRings()
    disableSector()
    setBearingLineMode(true)
  }, [bearingLineMode, disableAnnotations, disableBearingLine, disableMeasurement, disableRangeRings, disableSector])

  const handleMapAnnotationClick = useCallback((point: MapPoint) => {
    const nextId = nextAnnotationIdRef.current++
    setAnnotations(previous => [...previous, {
      id: `annotation-${nextId}`,
      label: `Mark ${nextId}`,
      lat: point.lat,
      lng: point.lng,
    }])
  }, [])

  const handleMapRangeRingAnchorClick = useCallback((point: MapPoint) => {
    setRangeRingAnchor(point)
  }, [])

  const handleMapSectorAnchorClick = useCallback((point: MapPoint) => {
    setSectorAnchor(point)
  }, [])

  const handleMapBearingLineAnchorClick = useCallback((point: MapPoint) => {
    setBearingLineAnchor(point)
  }, [])

  const handleMapCoordinateClick = useCallback((point: MapPoint) => {
    setMeasurementPoints(previous => (previous.length >= 2 ? [point] : [...previous, point]))
  }, [])

  return {
    annotationMode,
    annotations,
    bearingLineAnchor,
    bearingLineDegrees,
    bearingLineDegreesInput,
    bearingLineDistanceInput,
    bearingLineDistanceKm,
    bearingLineMode,
    bearingLineUnit,
    clearAnnotations,
    clearBearingLine,
    clearMeasurement,
    clearRangeRings,
    clearSector,
    disableAnnotations,
    disableBearingLine,
    disableMeasurement,
    disableRangeRings,
    disableSector,
    handleMapAnnotationClick,
    handleMapBearingLineAnchorClick,
    handleMapCoordinateClick,
    handleMapRangeRingAnchorClick,
    handleMapSectorAnchorClick,
    measurementMode,
    measurementPoints,
    rangeRingAnchor,
    rangeRingInputs,
    rangeRingMode,
    rangeRingRadiiKm,
    rangeRingUnit,
    removeAnnotation,
    sectorAnchor,
    sectorArcDegrees,
    sectorArcInput,
    sectorDegrees,
    sectorDegreesInput,
    sectorDistanceInput,
    sectorDistanceKm,
    sectorMode,
    sectorUnit,
    setBearingLineDisplayUnit,
    setRangeRingDisplayUnit,
    setSectorDisplayUnit,
    toggleAnnotations,
    toggleBearingLine,
    toggleMeasurement,
    toggleRangeRings,
    toggleSector,
    updateAnnotationLabel,
    updateBearingLineDegreesInput,
    updateBearingLineDistanceInput,
    updateRangeRingInput,
    updateSectorArcInput,
    updateSectorDegreesInput,
    updateSectorDistanceInput,
  }
}
