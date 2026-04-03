/**
 * useGlobeOverlays
 *
 * Manages Cesium entity layers for area-of-operation polygons, geofence rings,
 * geofence breach rings, sensor coverage circles, chokepoint watch circles,
 * and signal heatmap cells. Extracted from useGlobeEngine to keep the main
 * hook focused on viewer lifecycle, site/asset entities, signals, and click
 * handling.
 *
 * All entity maps are internal — the caller can look up entities via
 * getOverlayEntity() for projection / instrumentation needs.
 */

import { useEffect, useRef } from 'react'
import type * as CesiumType from 'cesium'
import type { Site, AreaOfOperation, Chokepoint, Signal } from '../../api/types'
import type { CoverageCircle } from '../../lib/coverage'
import {
  breachPulseColorProperty,
  CHOKEPOINT_COLOR_BY_STATUS,
  COVERAGE_COLOR_BY_STATUS,
  heatmapColorCss,
  heatmapFillAlpha,
  heatmapOutlineAlpha,
  heatmapRadiusKm,
  pruneEntityMap,
  setEllipseColorProperty,
  setEllipseMaterialColor,
  setEllipseMaterialProperty,
  setEllipseNumericProperty,
  setEntityPosition,
  setPolygonHierarchy,
  setPolygonMaterialColor,
  setPolygonNumericProperty,
  setPolygonOutlineColor,
  type CesiumModule,
} from '../../lib/globeEngineHelpers'
import { buildGlobeSignalHeatmapCells } from '../../lib/globeSignalHeatmap'

export interface GlobeOverlaysInput {
  viewerRef:  React.RefObject<CesiumType.Viewer | null>
  cesiumRef:  React.RefObject<CesiumModule | null>
  viewerReady: boolean

  sites:            Site[]
  areaOfOperations: AreaOfOperation[]
  breachedSiteIds:  Set<string>
  coverageCircles:  CoverageCircle[]
  chokepoints:      Chokepoint[]
  signals:          Signal[]

  showCoverage:    boolean
  showChokepoints: boolean
  showSignals:     boolean
  showHeatmap:     boolean
  isCloseView:     boolean
}

export interface GlobeOverlaysReturn {
  /** Look up an overlay entity by its id string (e.g. "ao-123", "geofence-456"). */
  getOverlayEntity: (idString: string) => CesiumType.Entity | null
}

export function useGlobeOverlays({
  viewerRef,
  cesiumRef,
  viewerReady,
  sites,
  areaOfOperations,
  breachedSiteIds,
  coverageCircles,
  chokepoints,
  signals,
  showCoverage,
  showChokepoints,
  showSignals,
  showHeatmap,
  isCloseView,
}: GlobeOverlaysInput): GlobeOverlaysReturn {
  const aoEntitiesRef        = useRef<Map<string, CesiumType.Entity>>(new Map())
  const geofenceEntitiesRef  = useRef<Map<string, CesiumType.Entity>>(new Map())
  const breachEntitiesRef    = useRef<Map<string, CesiumType.Entity>>(new Map())
  const coverageEntitiesRef  = useRef<Map<string, CesiumType.Entity>>(new Map())
  const chokepointEntitiesRef = useRef<Map<string, CesiumType.Entity>>(new Map())
  const heatmapEntitiesRef   = useRef<Map<string, CesiumType.Entity>>(new Map())

  // ---------------------------------------------------------------------------
  // AO polygon entities — incremental add/update/remove
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const currentIds = new Set(areaOfOperations.map(ao => `ao-${ao.id}`))
    pruneEntityMap(viewer, aoEntitiesRef.current, currentIds)

    for (const ao of areaOfOperations) {
      const key       = `ao-${ao.id}`
      const coords    = ao.geometry.coordinates[0] as [number, number][]
      const flat      = coords.flatMap(([lng, lat]) => [lng, lat])
      const positions = Cesium.Cartesian3.fromDegreesArray(flat)
      const fillColor = Cesium.Color.fromCssColorString(ao.color).withAlpha(0.15)
      const lineColor = Cesium.Color.fromCssColorString(ao.color).withAlpha(0.8)

      const existing = aoEntitiesRef.current.get(key)
      if (existing?.polygon) {
        existing.name = ao.name
        setPolygonHierarchy(Cesium, existing.polygon, positions)
        setPolygonMaterialColor(Cesium, existing.polygon, fillColor)
        setPolygonOutlineColor(Cesium, existing.polygon, lineColor)
        setPolygonNumericProperty(Cesium, existing.polygon.outlineWidth, 2, next => { existing.polygon!.outlineWidth = next })
        setPolygonNumericProperty(Cesium, existing.polygon.height, 0, next => { existing.polygon!.height = next })
        continue
      }

      const entity = viewer.entities.add({
        id:   key,
        name: ao.name,
        polygon: {
          hierarchy:    new Cesium.PolygonHierarchy(positions),
          material:     fillColor,
          outline:      new Cesium.ConstantProperty(true),
          outlineColor: new Cesium.ConstantProperty(lineColor),
          outlineWidth: new Cesium.ConstantProperty(2),
          height:       new Cesium.ConstantProperty(0),
        },
      })
      aoEntitiesRef.current.set(key, entity)
    }
  }, [viewerReady, areaOfOperations, cesiumRef, viewerRef])

  // ---------------------------------------------------------------------------
  // Geofence rings — baseline site geofence footprint
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const geofenceSites = sites.filter(site => site.geofence_radius_km > 0)
    const currentIds = new Set(geofenceSites.map(site => `geofence-${site.id}`))
    pruneEntityMap(viewer, geofenceEntitiesRef.current, currentIds)

    for (const site of geofenceSites) {
      const key = `geofence-${site.id}`
      const radiusMeters = site.geofence_radius_km * 1000
      const fillColor = Cesium.Color.fromCssColorString('#5c7cfa').withAlpha(0.04)
      const outlineColor = Cesium.Color.fromCssColorString('#5c7cfa').withAlpha(0.6)
      const existing = geofenceEntitiesRef.current.get(key)

      if (existing?.ellipse) {
        existing.name = `${site.name} geofence`
        setEntityPosition(Cesium, existing, Number(site.longitude), Number(site.latitude))
        setEllipseNumericProperty(Cesium, existing.ellipse.semiMajorAxis, radiusMeters, next => { existing.ellipse!.semiMajorAxis = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.semiMinorAxis, radiusMeters, next => { existing.ellipse!.semiMinorAxis = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.height, 0, next => { existing.ellipse!.height = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.outlineWidth, 1, next => { existing.ellipse!.outlineWidth = next })
        setEllipseMaterialColor(Cesium, existing.ellipse, fillColor)
        setEllipseColorProperty(Cesium, existing.ellipse.outlineColor, outlineColor, next => { existing.ellipse!.outlineColor = next })
        continue
      }

      const entity = viewer.entities.add({
        id: key,
        name: `${site.name} geofence`,
        position: Cesium.Cartesian3.fromDegrees(Number(site.longitude), Number(site.latitude)),
        ellipse: {
          semiMajorAxis: new Cesium.ConstantProperty(radiusMeters),
          semiMinorAxis: new Cesium.ConstantProperty(radiusMeters),
          material: new Cesium.ColorMaterialProperty(fillColor),
          outline: new Cesium.ConstantProperty(true),
          outlineColor: new Cesium.ConstantProperty(outlineColor),
          outlineWidth: new Cesium.ConstantProperty(1),
          height: new Cesium.ConstantProperty(0),
        },
      })
      geofenceEntitiesRef.current.set(key, entity)
    }
  }, [sites, viewerReady, cesiumRef, viewerRef])

  // ---------------------------------------------------------------------------
  // Geofence breach rings — live-only active breaches rendered over base geofence
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const breachedSites = sites.filter(site => site.geofence_radius_km > 0 && breachedSiteIds.has(site.id))
    const currentIds = new Set(breachedSites.map(site => `geofence-breach-${site.id}`))
    pruneEntityMap(viewer, breachEntitiesRef.current, currentIds)
    const pulsingFillColor = breachPulseColorProperty(Cesium, 'fill')
    const pulsingOutlineColor = breachPulseColorProperty(Cesium, 'outline')

    for (const site of breachedSites) {
      const key = `geofence-breach-${site.id}`
      const radiusMeters = site.geofence_radius_km * 1000
      const existing = breachEntitiesRef.current.get(key)

      if (existing?.ellipse) {
        existing.name = `${site.name} geofence breach`
        setEntityPosition(Cesium, existing, Number(site.longitude), Number(site.latitude))
        setEllipseNumericProperty(Cesium, existing.ellipse.semiMajorAxis, radiusMeters, next => { existing.ellipse!.semiMajorAxis = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.semiMinorAxis, radiusMeters, next => { existing.ellipse!.semiMinorAxis = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.height, 0, next => { existing.ellipse!.height = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.outlineWidth, 2, next => { existing.ellipse!.outlineWidth = next })
        setEllipseMaterialProperty(Cesium, existing.ellipse, pulsingFillColor)
        existing.ellipse.outlineColor = pulsingOutlineColor
        continue
      }

      const entity = viewer.entities.add({
        id: key,
        name: `${site.name} geofence breach`,
        position: Cesium.Cartesian3.fromDegrees(Number(site.longitude), Number(site.latitude)),
        ellipse: {
          semiMajorAxis: new Cesium.ConstantProperty(radiusMeters),
          semiMinorAxis: new Cesium.ConstantProperty(radiusMeters),
          material: new Cesium.ColorMaterialProperty(pulsingFillColor),
          outline: new Cesium.ConstantProperty(true),
          outlineColor: pulsingOutlineColor,
          outlineWidth: new Cesium.ConstantProperty(2),
          height: new Cesium.ConstantProperty(0),
        },
      })
      breachEntitiesRef.current.set(key, entity)
    }
  }, [breachedSiteIds, sites, viewerReady, cesiumRef, viewerRef])

  // ---------------------------------------------------------------------------
  // Coverage circles — incremental add/update/remove using ellipse entities
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const keyForCircle = (circle: CoverageCircle) => [
      'coverage',
      circle.assetId,
      circle.anchorKey,
    ].join('-')

    const currentIds = new Set(coverageCircles.map(keyForCircle))
    pruneEntityMap(viewer, coverageEntitiesRef.current, currentIds)

    for (const circle of coverageCircles) {
      const key = keyForCircle(circle)
      const radiusMeters = circle.radiusKm * 1000
      const baseColor = Cesium.Color.fromCssColorString(COVERAGE_COLOR_BY_STATUS[circle.status] ?? '#8f99a8')
      const fillColor = baseColor.withAlpha(circle.status === 'degraded' ? 0.06 : 0.08)
      const outlineColor = baseColor.withAlpha(circle.status === 'degraded' ? 0.75 : 0.55)
      const outlineWidth = circle.status === 'degraded' ? 1.25 : 1.5
      const existing = coverageEntitiesRef.current.get(key)

      if (existing?.ellipse) {
        existing.show = showCoverage
        existing.name = `${circle.assetName} coverage`
        setEntityPosition(Cesium, existing, circle.anchorLng, circle.anchorLat)
        setEllipseNumericProperty(Cesium, existing.ellipse.semiMajorAxis, radiusMeters, next => { existing.ellipse!.semiMajorAxis = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.semiMinorAxis, radiusMeters, next => { existing.ellipse!.semiMinorAxis = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.height, 0, next => { existing.ellipse!.height = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.outlineWidth, outlineWidth, next => { existing.ellipse!.outlineWidth = next })
        setEllipseMaterialColor(Cesium, existing.ellipse, fillColor)
        setEllipseColorProperty(Cesium, existing.ellipse.outlineColor, outlineColor, next => { existing.ellipse!.outlineColor = next })
        continue
      }

      const entity = viewer.entities.add({
        id: key,
        name: `${circle.assetName} coverage`,
        show: showCoverage,
        position: Cesium.Cartesian3.fromDegrees(circle.anchorLng, circle.anchorLat),
        ellipse: {
          semiMajorAxis: new Cesium.ConstantProperty(radiusMeters),
          semiMinorAxis: new Cesium.ConstantProperty(radiusMeters),
          material: new Cesium.ColorMaterialProperty(fillColor),
          outline: new Cesium.ConstantProperty(true),
          outlineColor: new Cesium.ConstantProperty(outlineColor),
          outlineWidth: new Cesium.ConstantProperty(outlineWidth),
          height: new Cesium.ConstantProperty(0),
        },
      })
      coverageEntitiesRef.current.set(key, entity)
    }
  }, [coverageCircles, showCoverage, viewerReady, cesiumRef, viewerRef])

  // ---------------------------------------------------------------------------
  // Chokepoint watch circles — status-colored ellipse entities
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const currentIds = new Set(chokepoints.map(cp => `chokepoint-${cp.id}`))
    pruneEntityMap(viewer, chokepointEntitiesRef.current, currentIds)

    for (const cp of chokepoints) {
      const key = `chokepoint-${cp.id}`
      const radiusMeters = cp.watch_radius_km * 1000
      const hex = CHOKEPOINT_COLOR_BY_STATUS[cp.status] ?? '#868e96'
      const baseColor = Cesium.Color.fromCssColorString(hex)
      const fillColor = baseColor.withAlpha(0.10)
      const outlineColor = baseColor.withAlpha(0.65)
      const existing = chokepointEntitiesRef.current.get(key)

      if (existing?.ellipse) {
        existing.show = showChokepoints
        existing.name = cp.name
        setEntityPosition(Cesium, existing, cp.longitude, cp.latitude)
        setEllipseNumericProperty(Cesium, existing.ellipse.semiMajorAxis, radiusMeters, next => { existing.ellipse!.semiMajorAxis = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.semiMinorAxis, radiusMeters, next => { existing.ellipse!.semiMinorAxis = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.height, 0, next => { existing.ellipse!.height = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.outlineWidth, 1.5, next => { existing.ellipse!.outlineWidth = next })
        setEllipseMaterialColor(Cesium, existing.ellipse, fillColor)
        setEllipseColorProperty(Cesium, existing.ellipse.outlineColor, outlineColor, next => { existing.ellipse!.outlineColor = next })
        continue
      }

      const entity = viewer.entities.add({
        id: key,
        name: cp.name,
        show: showChokepoints,
        position: Cesium.Cartesian3.fromDegrees(cp.longitude, cp.latitude),
        ellipse: {
          semiMajorAxis: new Cesium.ConstantProperty(radiusMeters),
          semiMinorAxis: new Cesium.ConstantProperty(radiusMeters),
          material: new Cesium.ColorMaterialProperty(fillColor),
          outline: new Cesium.ConstantProperty(true),
          outlineColor: new Cesium.ConstantProperty(outlineColor),
          outlineWidth: new Cesium.ConstantProperty(1.5),
          height: new Cesium.ConstantProperty(0),
        },
      })
      chokepointEntitiesRef.current.set(key, entity)
    }
  }, [chokepoints, showChokepoints, viewerReady, cesiumRef, viewerRef])

  // ---------------------------------------------------------------------------
  // Signal heatmap — aggregated density cells rendered as translucent ellipses
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const Cesium = cesiumRef.current
    const viewer = viewerRef.current
    if (!viewerReady || !viewer || !Cesium) return

    const heatmapCells = buildGlobeSignalHeatmapCells(signals)
    const currentIds = new Set(heatmapCells.map(cell => `heatmap-${cell.key}`))
    pruneEntityMap(viewer, heatmapEntitiesRef.current, currentIds)

    const isVisible = showSignals && showHeatmap && !isCloseView

    for (const cell of heatmapCells) {
      const key = `heatmap-${cell.key}`
      const radiusMeters = heatmapRadiusKm(cell.intensity) * 1000
      const baseColor = Cesium.Color.fromCssColorString(heatmapColorCss(cell.intensity))
      const fillColor = baseColor.withAlpha(heatmapFillAlpha(cell.intensity))
      const outlineColor = baseColor.withAlpha(heatmapOutlineAlpha(cell.intensity))
      const existing = heatmapEntitiesRef.current.get(key)

      if (existing?.ellipse) {
        existing.show = isVisible
        existing.name = `Signal heatmap cell (${cell.count})`
        setEntityPosition(Cesium, existing, cell.lng, cell.lat)
        setEllipseNumericProperty(Cesium, existing.ellipse.semiMajorAxis, radiusMeters, next => { existing.ellipse!.semiMajorAxis = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.semiMinorAxis, radiusMeters, next => { existing.ellipse!.semiMinorAxis = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.height, 0, next => { existing.ellipse!.height = next })
        setEllipseNumericProperty(Cesium, existing.ellipse.outlineWidth, 1.25, next => { existing.ellipse!.outlineWidth = next })
        setEllipseMaterialColor(Cesium, existing.ellipse, fillColor)
        setEllipseColorProperty(Cesium, existing.ellipse.outlineColor, outlineColor, next => { existing.ellipse!.outlineColor = next })
        continue
      }

      const entity = viewer.entities.add({
        id: key,
        name: `Signal heatmap cell (${cell.count})`,
        show: isVisible,
        position: Cesium.Cartesian3.fromDegrees(cell.lng, cell.lat),
        ellipse: {
          semiMajorAxis: new Cesium.ConstantProperty(radiusMeters),
          semiMinorAxis: new Cesium.ConstantProperty(radiusMeters),
          material: new Cesium.ColorMaterialProperty(fillColor),
          outline: new Cesium.ConstantProperty(true),
          outlineColor: new Cesium.ConstantProperty(outlineColor),
          outlineWidth: new Cesium.ConstantProperty(1.25),
          height: new Cesium.ConstantProperty(0),
        },
      })
      heatmapEntitiesRef.current.set(key, entity)
    }
  }, [viewerReady, signals, showSignals, showHeatmap, isCloseView, cesiumRef, viewerRef])

  // ---------------------------------------------------------------------------
  // Entity lookup for projection / instrumentation
  // ---------------------------------------------------------------------------
  function getOverlayEntity(idString: string): CesiumType.Entity | null {
    return aoEntitiesRef.current.get(idString)
      ?? geofenceEntitiesRef.current.get(idString)
      ?? breachEntitiesRef.current.get(idString)
      ?? coverageEntitiesRef.current.get(idString)
      ?? chokepointEntitiesRef.current.get(idString)
      ?? heatmapEntitiesRef.current.get(idString)
      ?? null
  }

  return { getOverlayEntity }
}
