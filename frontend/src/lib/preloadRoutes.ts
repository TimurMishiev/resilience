import type * as MapLibreModule from 'maplibre-gl'
import type * as CesiumModule from 'cesium'

let mapPagePromise: Promise<unknown> | null = null
let globePagePromise: Promise<unknown> | null = null
let mapRuntimePromise: Promise<typeof MapLibreModule> | null = null
let globeRuntimePromise: Promise<typeof CesiumModule> | null = null
let mapExperiencePromise: Promise<unknown> | null = null
let globeExperiencePromise: Promise<unknown> | null = null

export function preloadMapPage() {
  if (!mapPagePromise) {
    mapPagePromise = import('../pages/MapPage').catch(error => {
      mapPagePromise = null
      throw error
    })
  }
  return mapPagePromise
}

export function preloadGlobePage() {
  if (!globePagePromise) {
    globePagePromise = import('../pages/GlobePage').catch(error => {
      globePagePromise = null
      throw error
    })
  }
  return globePagePromise
}

export function preloadMapRuntime() {
  if (!mapRuntimePromise) {
    mapRuntimePromise = Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ]).then(([maplibre]) => maplibre).catch(error => {
      mapRuntimePromise = null
      throw error
    })
  }
  return mapRuntimePromise
}

export function preloadGlobeRuntime() {
  if (!globeRuntimePromise) {
    globeRuntimePromise = Promise.all([
      import('cesium'),
      import('cesium/Build/Cesium/Widgets/widgets.css'),
    ]).then(([cesium]) => cesium).catch(error => {
      globeRuntimePromise = null
      throw error
    })
  }
  return globeRuntimePromise
}

export function preloadMapExperience() {
  if (!mapExperiencePromise) {
    mapExperiencePromise = Promise.all([
      preloadMapPage(),
      preloadMapRuntime(),
    ]).catch(error => {
      mapExperiencePromise = null
      throw error
    })
  }
  return mapExperiencePromise
}

export function preloadGlobeExperience() {
  if (!globeExperiencePromise) {
    globeExperiencePromise = Promise.all([
      preloadGlobePage(),
      preloadGlobeRuntime(),
    ]).catch(error => {
      globeExperiencePromise = null
      throw error
    })
  }
  return globeExperiencePromise
}
