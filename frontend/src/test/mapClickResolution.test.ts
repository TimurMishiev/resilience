import { describe, expect, it } from 'vitest'
import { MAP_INTERACTIVE_LAYER_IDS, resolveMapClickCandidate } from '../lib/mapClickResolution'

describe('mapClickResolution', () => {
  it('exposes the interactive layer ids used for click arbitration', () => {
    expect(MAP_INTERACTIVE_LAYER_IDS).toEqual([
      'site-circles',
      'site-selection-ring',
      'asset-circles',
      'asset-symbols',
      'asset-selection-ring',
      'signal-clusters',
      'signal-cluster-count',
      'signal-circles',
      'signal-symbols',
      'selected-signal-ring',
      'selected-signal-circle',
      'selected-signal-symbol',
    ])
  })

  it('chooses the first interactive feature from rendered feature order', () => {
    const resolved = resolveMapClickCandidate([
      { layer: { id: 'asset-symbols' }, properties: { id: 'asset-1' } },
      { layer: { id: 'site-circles' }, properties: { id: 'site-1' } },
    ])

    expect(resolved).toMatchObject({
      kind: 'asset',
      layerId: 'asset-symbols',
      feature: { properties: { id: 'asset-1' } },
    })
  })

  it('ignores non-interactive layers and finds the first valid candidate', () => {
    const resolved = resolveMapClickCandidate([
      { layer: { id: 'sensor-coverage-fill' }, properties: { asset_id: 'asset-1' } },
      { layer: { id: 'signal-clusters' }, properties: { cluster_id: 42 } },
      { layer: { id: 'site-circles' }, properties: { id: 'site-1' } },
    ])

    expect(resolved).toMatchObject({
      kind: 'cluster',
      layerId: 'signal-clusters',
      feature: { properties: { cluster_id: 42 } },
    })
  })

  it('returns null when no interactive map feature is present', () => {
    expect(resolveMapClickCandidate([
      { layer: { id: 'sensor-coverage-fill' } },
      { layer: { id: 'ao-fill' } },
    ])).toBeNull()
  })
})
