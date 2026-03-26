import { describe, expect, it } from 'vitest'
import type { Signal, SignalType } from '../api/types'
import { mergeSignals, pruneSignalMapByType, sortSignalsNewestFirst } from '../lib/liveSignals'

function makeSignal(
  id: string,
  signalType: SignalType,
  occurredAt: string,
  ingestedAt = occurredAt,
): Signal {
  return {
    id,
    source: 'manual',
    signal_type: signalType,
    external_id: id,
    lat: 10,
    lng: 20,
    altitude: null,
    speed: null,
    heading: null,
    magnitude: null,
    raw_payload: {},
    occurred_at: occurredAt,
    ingested_at: ingestedAt,
  }
}

describe('liveSignals', () => {
  it('sorts newest signals first by occurred_at', () => {
    const oldest = makeSignal('sig-1', 'manual', '2026-03-26T10:00:00.000Z')
    const newest = makeSignal('sig-2', 'manual', '2026-03-26T12:00:00.000Z')
    const middle = makeSignal('sig-3', 'manual', '2026-03-26T11:00:00.000Z')

    expect(sortSignalsNewestFirst([oldest, newest, middle]).map(signal => signal.id)).toEqual([
      'sig-2',
      'sig-3',
      'sig-1',
    ])
  })

  it('prunes oldest signals by type while preserving other types', () => {
    const signals = new Map<string, Signal>([
      ['a-1', makeSignal('a-1', 'manual', '2026-03-26T10:00:00.000Z')],
      ['a-2', makeSignal('a-2', 'manual', '2026-03-26T11:00:00.000Z')],
      ['a-3', makeSignal('a-3', 'manual', '2026-03-26T12:00:00.000Z')],
      ['b-1', makeSignal('b-1', 'gps_jamming', '2026-03-26T09:00:00.000Z')],
    ])

    const pruned = pruneSignalMapByType(signals, { manual: 2, gps_jamming: 1 })

    expect(Array.from(pruned.keys()).sort()).toEqual(['a-2', 'a-3', 'b-1'])
  })

  it('merges incoming signals, overwrites by id, and enforces per-type limits', () => {
    const previous = new Map<string, Signal>([
      ['sig-1', makeSignal('sig-1', 'manual', '2026-03-26T10:00:00.000Z', '2026-03-26T10:00:00.000Z')],
      ['sig-2', makeSignal('sig-2', 'manual', '2026-03-26T11:00:00.000Z', '2026-03-26T11:00:00.000Z')],
    ])

    const merged = mergeSignals(previous, [
      makeSignal('sig-2', 'manual', '2026-03-26T11:30:00.000Z', '2026-03-26T11:30:00.000Z'),
      makeSignal('sig-3', 'manual', '2026-03-26T12:00:00.000Z', '2026-03-26T12:00:00.000Z'),
    ], { manual: 2 })

    expect(sortSignalsNewestFirst(Array.from(merged.values())).map(signal => signal.id)).toEqual([
      'sig-3',
      'sig-2',
    ])
    expect(merged.get('sig-2')?.occurred_at).toBe('2026-03-26T11:30:00.000Z')
  })
})
