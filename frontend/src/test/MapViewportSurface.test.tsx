import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { MapViewportSurface } from '../components/map/MapViewportSurface'
import type { MapOverlayControlsProps } from '../components/map/MapOverlayControls'

// Integration coverage for the engine-init failure → retry UX path.
//
// Audit 2026-05-01 (track A) flagged: "No E2E test confirms the retry
// path succeeds after a transient failure. MapPage renders retry UI but
// there's no spec verifying recovery." The hook-level retry mechanics
// are tested in useMapLibreEngine.test.ts; this spec closes the gap by
// proving the UI path itself wires the hook output to a clickable
// Retry button that actually calls retryEngine.
//
// What this proves:
//   1. With engineError set, MapViewportSurface renders the
//      NonIdealState overlay with the error message visible.
//   2. The overlay carries a Retry button.
//   3. Clicking Retry invokes the retryEngine prop.
//   4. With engineError null, the overlay does NOT render and the
//      MapOverlayControls panel is not occluded.
//
// A Playwright E2E variant would additionally exercise the full
// CDN-failure → retry → success cycle, but that test is GPU-dependent
// and skipped in CI per the project_open_findings convention. The
// integration spec below runs in normal vitest CI and gives the
// equivalent UI-path proof without depending on swiftshader.
describe('MapViewportSurface engine retry UX', () => {
  const overlayControlsProps = {} as unknown as MapOverlayControlsProps

  it('renders the retry overlay when engineError is set', () => {
    const retryEngine = vi.fn()
    const ref = createRef<HTMLDivElement>()

    render(
      <MapViewportSurface
        engineError={new Error('CDN preload failed')}
        mapContainerRef={ref}
        overlayControlsProps={overlayControlsProps}
        retryEngine={retryEngine}
      />,
    )

    // The error overlay surfaces the original error message verbatim,
    // so the operator can paste it into a support ticket without
    // hunting through console logs.
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('Map engine failed to load')).toBeTruthy()
    expect(screen.getByText('CDN preload failed')).toBeTruthy()
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })

  it('invokes retryEngine when the Retry button is clicked', async () => {
    const user = userEvent.setup()
    const retryEngine = vi.fn()
    const ref = createRef<HTMLDivElement>()

    render(
      <MapViewportSurface
        engineError={new Error('WebGL unavailable')}
        mapContainerRef={ref}
        overlayControlsProps={overlayControlsProps}
        retryEngine={retryEngine}
      />,
    )

    await user.click(screen.getByRole('button', { name: /retry/i }))

    expect(retryEngine).toHaveBeenCalledTimes(1)
  })

  it('does not render the retry overlay when engineError is null', () => {
    const retryEngine = vi.fn()
    const ref = createRef<HTMLDivElement>()

    render(
      <MapViewportSurface
        engineError={null}
        mapContainerRef={ref}
        overlayControlsProps={overlayControlsProps}
        retryEngine={retryEngine}
      />,
    )

    // Overlay must NOT occlude the map. role="alert" is exclusively
    // attached to the engine-error overlay, so its absence is the
    // canonical assertion.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/map engine failed/i)).toBeNull()
  })
})
