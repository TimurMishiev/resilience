import { describe, expect, it } from 'vitest'
import {
  buildEntitySelectionPath,
  buildEntitySelectionSearch,
  buildEntitySelectionSyncLocationState,
  buildMapGlobeSelectionPath,
  clearEntitySelectionRoute,
  consumeEntitySelectionSyncLocationState,
  hasEntitySelectionRoute,
  isEntitySelectionRouteAuthoritative,
  isEntitySelectionMissingAfterLoad,
  parseEntitySelectionRoute,
  readEntitySelectionSyncLocationState,
  shouldClearEntitySelectionAfterLoad,
  trackEntitySelectionSyncToken,
} from '../lib/entitySelectionRoute'

describe('entitySelectionRoute', () => {
  it('parses entity selection params from search', () => {
    expect(parseEntitySelectionRoute('?site_id=site-1&asset_id=asset-2&signal_id=signal-3')).toEqual({
      siteId: 'site-1',
      assetId: null,
      signalId: null,
    })
  })

  it('detects when a map or globe route carries entity selection', () => {
    expect(hasEntitySelectionRoute('?asset_id=asset-2')).toBe(true)
    expect(hasEntitySelectionRoute('?foo=bar')).toBe(false)
  })

  it('builds a map or globe path that preserves only entity selection params', () => {
    expect(buildMapGlobeSelectionPath('/globe', '?signal_id=signal-3&foo=bar')).toBe('/globe?signal_id=signal-3')
    expect(buildMapGlobeSelectionPath('/map', '')).toBe('/map')
  })

  it('builds a route path with normalized selection while preserving unrelated params when requested', () => {
    expect(buildEntitySelectionPath('/map', '?foo=bar', {
      siteId: null,
      assetId: 'asset-2',
      signalId: 'signal-3',
    })).toBe('/map?foo=bar&asset_id=asset-2')
  })

  it('writes a normalized entity selection back into search while preserving unrelated params', () => {
    expect(buildEntitySelectionSearch('?foo=bar&asset_id=asset-2', {
      siteId: 'site-1',
      assetId: 'asset-2',
      signalId: 'signal-3',
    })).toBe('?foo=bar&site_id=site-1')
  })

  it('clears entity selection params without disturbing unrelated query params', () => {
    expect(clearEntitySelectionRoute('?site_id=site-1&foo=bar')).toBe('?foo=bar')
    expect(clearEntitySelectionRoute('?signal_id=signal-3')).toBe('')
  })

  it('round-trips selection sync metadata through location state without dropping unrelated keys', () => {
    const state = buildEntitySelectionSyncLocationState(
      { from: 'sidebar' },
      { source: 'map', token: 7 },
    )

    expect(readEntitySelectionSyncLocationState(state)).toEqual({
      source: 'map',
      token: 7,
    })
    expect(state).toMatchObject({
      from: 'sidebar',
    })
  })

  it('consumes only pending self-authored selection sync tokens', () => {
    const pendingTokens = new Set([1, 2])

    expect(consumeEntitySelectionSyncLocationState(
      buildEntitySelectionSyncLocationState(null, { source: 'map', token: 1 }),
      'map',
      pendingTokens,
    )).toBe(true)
    expect(pendingTokens).toEqual(new Set([2]))

    expect(consumeEntitySelectionSyncLocationState(
      buildEntitySelectionSyncLocationState(null, { source: 'map', token: 1 }),
      'map',
      pendingTokens,
    )).toBe(false)

    expect(consumeEntitySelectionSyncLocationState(
      buildEntitySelectionSyncLocationState(null, { source: 'globe', token: 2 }),
      'map',
      pendingTokens,
    )).toBe(false)

    expect(consumeEntitySelectionSyncLocationState(
      buildEntitySelectionSyncLocationState(null, { source: 'map', token: 2 }),
      'map',
      pendingTokens,
    )).toBe(true)
    expect(pendingTokens.size).toBe(0)
  })

  it('falls back cleanly when location state is absent or unrelated', () => {
    const pendingTokens = new Set([1])

    expect(readEntitySelectionSyncLocationState(null)).toBeNull()
    expect(consumeEntitySelectionSyncLocationState(null, 'map', pendingTokens)).toBe(false)
    expect(consumeEntitySelectionSyncLocationState({ from: 'deep-link' }, 'map', pendingTokens)).toBe(false)
    expect(pendingTokens).toEqual(new Set([1]))
  })

  it('caps pending self-authored selection sync tokens to the most recent entries', () => {
    const pendingTokens = new Set<number>()

    for (let token = 1; token <= 25; token += 1) {
      trackEntitySelectionSyncToken(pendingTokens, token)
    }

    expect(Array.from(pendingTokens)).toEqual([
      6, 7, 8, 9, 10,
      11, 12, 13, 14, 15,
      16, 17, 18, 19, 20,
      21, 22, 23, 24, 25,
    ])
  })

  it('treats selected entities as stale only after the relevant dataset has settled without them', () => {
    expect(isEntitySelectionMissingAfterLoad(
      { siteId: 'site-1', assetId: null, signalId: null },
      {
        sitesLoaded: false,
        assetsLoaded: true,
        signalsLoaded: true,
        siteIds: [],
        assetIds: [],
        signalIds: [],
      },
    )).toBe(false)

    expect(isEntitySelectionMissingAfterLoad(
      { siteId: 'site-1', assetId: null, signalId: null },
      {
        sitesLoaded: true,
        assetsLoaded: true,
        signalsLoaded: true,
        siteIds: ['site-2'],
        assetIds: [],
        signalIds: [],
      },
    )).toBe(true)

    expect(isEntitySelectionMissingAfterLoad(
      { siteId: null, assetId: 'asset-1', signalId: null },
      {
        sitesLoaded: true,
        assetsLoaded: false,
        signalsLoaded: true,
        siteIds: [],
        assetIds: [],
        signalIds: [],
      },
    )).toBe(false)

    expect(isEntitySelectionMissingAfterLoad(
      { siteId: null, assetId: 'asset-1', signalId: null },
      {
        sitesLoaded: true,
        assetsLoaded: true,
        signalsLoaded: true,
        siteIds: [],
        assetIds: ['asset-2'],
        signalIds: [],
      },
    )).toBe(true)

    expect(isEntitySelectionMissingAfterLoad(
      { siteId: null, assetId: 'asset-1', signalId: null },
      {
        sitesLoaded: true,
        assetsLoaded: true,
        signalsLoaded: true,
        siteIds: [],
        assetIds: ['asset-1'],
        signalIds: [],
      },
    )).toBe(false)

    expect(isEntitySelectionMissingAfterLoad(
      { siteId: null, assetId: null, signalId: 'signal-1' },
      {
        sitesLoaded: true,
        assetsLoaded: true,
        signalsLoaded: true,
        siteIds: [],
        assetIds: [],
        signalIds: ['signal-1'],
      },
    )).toBe(false)
  })

  it('treats same-surface sync metadata as non-authoritative for stale route cleanup', () => {
    expect(isEntitySelectionRouteAuthoritative(
      buildEntitySelectionSyncLocationState(null, { source: 'map', token: 3 }),
      'map',
    )).toBe(false)

    expect(isEntitySelectionRouteAuthoritative(
      buildEntitySelectionSyncLocationState(null, { source: 'globe', token: 3 }),
      'map',
    )).toBe(true)

    expect(isEntitySelectionRouteAuthoritative(null, 'map')).toBe(true)
  })

  it('keeps a newer local selection when a stale same-surface route write lands out of order', () => {
    const availability = {
      sitesLoaded: true,
      assetsLoaded: true,
      signalsLoaded: true,
      siteIds: ['site-2'],
      assetIds: [],
      signalIds: [],
    }

    expect(shouldClearEntitySelectionAfterLoad(
      { siteId: 'site-1', assetId: null, signalId: null },
      { siteId: 'site-2', assetId: null, signalId: null },
      availability,
      false,
    )).toBe(false)

    expect(shouldClearEntitySelectionAfterLoad(
      { siteId: 'site-1', assetId: null, signalId: null },
      { siteId: 'site-2', assetId: null, signalId: null },
      availability,
      true,
    )).toBe(true)
  })

  it('does not clear an asset selection before assetsLoaded settles', () => {
    // assetsLoaded=false means the dataset is still loading — isEntitySelectionMissingAfterLoad
    // returns false for both route and state, so shouldClear must be false regardless of whether
    // the asset is currently in the list.
    expect(shouldClearEntitySelectionAfterLoad(
      { siteId: null, assetId: 'asset-1', signalId: null },
      { siteId: null, assetId: 'asset-1', signalId: null },
      {
        sitesLoaded: true,
        assetsLoaded: false,
        signalsLoaded: true,
        siteIds: [],
        assetIds: [],
        signalIds: [],
      },
    )).toBe(false)
  })

  it('clears a stale asset route and selection once assetsLoaded is true and the asset is absent', () => {
    // Once assetsLoaded=true the dataset is authoritative — an asset absent from assetIds is stale.
    // Both route and state carry the same stale asset-1; state triggers the clear independently of
    // routeAuthoritative, so both true and false must result in a clear here.
    const availability = {
      sitesLoaded: true,
      assetsLoaded: true,
      signalsLoaded: true,
      siteIds: [],
      assetIds: ['asset-2'],
      signalIds: [],
    }

    // routeAuthoritative=true: route missing + state missing → clear
    expect(shouldClearEntitySelectionAfterLoad(
      { siteId: null, assetId: 'asset-1', signalId: null },
      { siteId: null, assetId: 'asset-1', signalId: null },
      availability,
      true,
    )).toBe(true)

    // routeAuthoritative=false: route not checked, but state is still missing → clear
    expect(shouldClearEntitySelectionAfterLoad(
      { siteId: null, assetId: 'asset-1', signalId: null },
      { siteId: null, assetId: 'asset-1', signalId: null },
      availability,
      false,
    )).toBe(true)
  })
})
