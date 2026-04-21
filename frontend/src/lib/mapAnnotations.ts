export type MapAnnotation = {
  id: string
  label: string
  lat: number
  lng: number
}

export function buildMapAnnotationFeatureCollection(
  annotations: MapAnnotation[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: annotations.map(annotation => ({
      type: 'Feature',
      properties: {
        id: annotation.id,
        label: annotation.label,
      },
      geometry: {
        type: 'Point',
        coordinates: [annotation.lng, annotation.lat],
      },
    })),
  }
}
