import { Button, NonIdealState } from '@blueprintjs/core'
import type { RefObject } from 'react'
import { MapOverlayControls, type MapOverlayControlsProps } from './MapOverlayControls'

interface MapViewportSurfaceProps {
  engineError: Error | null
  mapContainerRef: RefObject<HTMLDivElement | null>
  overlayControlsProps: MapOverlayControlsProps
  retryEngine: () => void
}

export function MapViewportSurface({
  engineError,
  mapContainerRef,
  overlayControlsProps,
  retryEngine,
}: MapViewportSurfaceProps) {
  return (
    <div className="map-viewport">
      <div ref={mapContainerRef} className="map-container" />

      {/* Engine init failure overlay. Without this, a CDN failure on
          the maplibre-gl dynamic import or a WebGL-context-unavailable
          browser left the user staring at a blank canvas with no error
          state. The hook's retryEngine clears the error and re-runs
          the init effect; the overlay vanishes when init succeeds. */}
      {engineError && (
        <div className="map-engine-error-overlay" role="alert">
          <NonIdealState
            icon="error"
            title="Map engine failed to load"
            description={
              <>
                <p>{engineError.message}</p>
                <p style={{ fontSize: 12, color: 'var(--bp5-text-color-muted)' }}>
                  This usually means the map runtime could not be downloaded
                  (network blip, CDN outage) or the browser is missing WebGL
                  support.
                </p>
              </>
            }
            action={
              <Button intent="primary" icon="refresh" onClick={retryEngine}>
                Retry
              </Button>
            }
          />
        </div>
      )}

      <MapOverlayControls {...overlayControlsProps} />
    </div>
  )
}
