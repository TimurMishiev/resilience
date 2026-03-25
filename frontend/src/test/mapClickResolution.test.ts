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

  it('prioritizes site selection over overlaid asset and signal features', () => {
    const resolved = resolveMapClickCandidate([
      { layer: { id: 'signal-symbols' }, properties: { id: 'signal-1' } },
      { layer: { id: 'asset-symbols' }, properties: { id: 'asset-1' } },
      { layer: { id: 'site-circles' }, properties: { id: 'site-1' } },
    ])

    expect(resolved).toMatchObject({
      kind: 'site',
      layerId: 'site-circles',
      feature: { properties: { id: 'site-1' } },
    })
  })

  it('preserves rendered feature order within the same semantic priority', () => {
    const resolved = resolveMapClickCandidate([
      { layer: { id: 'asset-symbols' }, properties: { id: 'asset-1' } },
      { layer: { id: 'asset-circles' }, properties: { id: 'asset-2' } },
    ])

    expect(resolved).toMatchObject({
      kind: 'asset',
      layerId: 'asset-symbols',
      feature: { properties: { id: 'asset-1' } },
    })
  })

  it('ignores non-interactive layers and still resolves clusters when no higher-priority target is present', () => {
    const resolved = resolveMapClickCandidate([
      { layer: { id: 'sensor-coverage-fill' }, properties: { asset_id: 'asset-1' } },
      { layer: { id: 'signal-clusters' }, properties: { cluster_id: 42 } },
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
