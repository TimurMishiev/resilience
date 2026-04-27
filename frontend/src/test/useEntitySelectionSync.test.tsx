import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  useEntitySelectionSync,
  type EntitySelectionSyncOptions,
} from '../hooks/useEntitySelectionSync'

// ── Tranche 6-C — selection-persistence contract ─────────────────────────────
//
// The product-level contract these tests pin (per user direction 2026-04-26):
//   - While `isReplaying`, selection persists across `asOf` changes.
//   - Selection persists across replay entry AND replay exit when the
//     entity still exists in the dataset on the other side.
//   - Selection clears on:
//       (1) explicit deselect (onSiteClick(null) etc.)
//       (2) route/entity switch (URL change)
//       (3) authoritative miss in the asOf dataset (entity absent from
//           the canonical sites/assets/signals query result; covers
//           soft-deleted/archived as a hard miss)
//
// Live + asOf-change is intentionally NOT tested. That case was the
// pre-6-C clear mechanism, not a real product contract — live mode
// doesn't change asOf in normal flow.

const SITE = { id: 'site-1' }
const ASSET = { id: 'asset-1' }

function baseOptions(overrides: Partial<EntitySelectionSyncOptions> = {}): EntitySelectionSyncOptions {
  return {
    source: 'map',
    signals: [],
    signalsConnected: true,
    signalError: null,
    sites: [SITE],
    assets: [ASSET],
    sitesLoaded: true,
    assetsLoaded: true,
    isReplaying: false,
    asOf: null,
    ...overrides,
  }
}

function wrapper(initialEntries: string[] = ['/map']) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  }
}

describe('useEntitySelectionSync — Tranche 6-C selection-persistence contract', () => {
  it('persists selection when entering replay if the entity still exists', () => {
    const { result, rerender } = renderHook(
      (opts: EntitySelectionSyncOptions) => useEntitySelectionSync(opts),
      {
        initialProps: baseOptions(),
        wrapper: wrapper(),
      },
    )

    act(() => {
      result.current.onSiteClick('site-1')
    })
    expect(result.current.selectedSiteId).toBe('site-1')

    // Enter replay — sites array still includes site-1.
    rerender(baseOptions({ isReplaying: true, asOf: '2026-04-20T12:00:00.000Z' }))

    expect(result.current.selectedSiteId).toBe('site-1')
  })

  it('persists selection while scrubbing replay (asOf changes mid-replay)', () => {
    const { result, rerender } = renderHook(
      (opts: EntitySelectionSyncOptions) => useEntitySelectionSync(opts),
      {
        initialProps: baseOptions({ isReplaying: true, asOf: '2026-04-20T12:00:00.000Z' }),
        wrapper: wrapper(),
      },
    )

    act(() => {
      result.current.onSiteClick('site-1')
    })
    expect(result.current.selectedSiteId).toBe('site-1')

    // Scrub forward — same dataset, different asOf.
    rerender(baseOptions({ isReplaying: true, asOf: '2026-04-20T13:30:00.000Z' }))
    expect(result.current.selectedSiteId).toBe('site-1')

    // Scrub backward — still same dataset.
    rerender(baseOptions({ isReplaying: true, asOf: '2026-04-20T10:00:00.000Z' }))
    expect(result.current.selectedSiteId).toBe('site-1')
  })

  it('persists selection when exiting replay if the entity still exists in live data', () => {
    const { result, rerender } = renderHook(
      (opts: EntitySelectionSyncOptions) => useEntitySelectionSync(opts),
      {
        initialProps: baseOptions({ isReplaying: true, asOf: '2026-04-20T12:00:00.000Z' }),
        wrapper: wrapper(),
      },
    )

    act(() => {
      result.current.onSiteClick('site-1')
    })
    expect(result.current.selectedSiteId).toBe('site-1')

    // Exit replay — site-1 still in live sites array.
    rerender(baseOptions({ isReplaying: false, asOf: null }))
    expect(result.current.selectedSiteId).toBe('site-1')
  })

  it('clears selection on authoritative miss at the new asOf (entity absent from dataset)', () => {
    // Start with site-1 selected via the URL (?site_id=site-1) AND the
    // sites array — the stale-selection effect requires both URL state
    // and React state to be in sync before it considers a clear.
    const { result, rerender } = renderHook(
      (opts: EntitySelectionSyncOptions) => useEntitySelectionSync(opts),
      {
        initialProps: baseOptions({ isReplaying: true, asOf: '2026-04-20T12:00:00.000Z' }),
        wrapper: wrapper(['/map?site_id=site-1']),
      },
    )

    act(() => {
      result.current.onSiteClick('site-1')
    })
    expect(result.current.selectedSiteId).toBe('site-1')

    // Scrub to an asOf where site-1 didn't exist yet (or was archived):
    // the canonical sites query returns an empty array for this asOf.
    rerender(baseOptions({
      isReplaying: true,
      asOf: '2026-04-20T13:30:00.000Z',
      sites: [],
    }))

    expect(result.current.selectedSiteId).toBeNull()
  })

  it('clears selection on explicit deselect in any mode', () => {
    const { result } = renderHook(
      (opts: EntitySelectionSyncOptions) => useEntitySelectionSync(opts),
      {
        initialProps: baseOptions({ isReplaying: true, asOf: '2026-04-20T12:00:00.000Z' }),
        wrapper: wrapper(),
      },
    )

    act(() => {
      result.current.onSiteClick('site-1')
    })
    expect(result.current.selectedSiteId).toBe('site-1')

    act(() => {
      result.current.onSiteClick(null)
    })
    expect(result.current.selectedSiteId).toBeNull()
  })
})
