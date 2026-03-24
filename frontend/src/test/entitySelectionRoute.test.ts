import { describe, expect, it } from 'vitest'
import {
  buildEntitySelectionSearch,
  buildMapGlobeSelectionPath,
  clearEntitySelectionRoute,
  hasEntitySelectionRoute,
  parseEntitySelectionRoute,
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
})
