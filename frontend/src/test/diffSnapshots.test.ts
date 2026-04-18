import { describe, expect, it } from 'vitest'
import { diffSnapshots, formatDiffValue, isDiffEmpty } from '../utils/diffSnapshots'

describe('diffSnapshots', () => {
  it('returns an empty diff when both snapshots are identical', () => {
    const diff = diffSnapshots({ status: 'active', priority: 'high' }, { status: 'active', priority: 'high' })
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
    expect(diff.changed).toEqual([])
    expect(isDiffEmpty(diff)).toBe(true)
  })

  it('treats a null before_snapshot as a creation — every after field is "added"', () => {
    const diff = diffSnapshots(null, { id: 'i1', status: 'open' })
    expect(diff.added).toEqual([
      { key: 'id', after: 'i1' },
      { key: 'status', after: 'open' },
    ])
    expect(diff.removed).toEqual([])
    expect(diff.changed).toEqual([])
  })

  it('detects changed primitive fields', () => {
    const diff = diffSnapshots(
      { status: 'new', priority: 'normal' },
      { status: 'resolved', priority: 'normal' },
    )
    expect(diff.changed).toEqual([{ key: 'status', before: 'new', after: 'resolved' }])
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
  })

  it('detects added and removed fields independently', () => {
    const diff = diffSnapshots(
      { title: 'Patrol', old_flag: true },
      { title: 'Patrol', blocked_reason: 'weather' },
    )
    expect(diff.added).toEqual([{ key: 'blocked_reason', after: 'weather' }])
    expect(diff.removed).toEqual([{ key: 'old_flag', before: true }])
    expect(diff.changed).toEqual([])
  })

  it('compares nested objects structurally', () => {
    const diff = diffSnapshots(
      { meta: { score: 1, tags: ['a'] } },
      { meta: { score: 2, tags: ['a'] } },
    )
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0].key).toBe('meta')
  })

  it('treats null and missing as distinct', () => {
    const diff = diffSnapshots({ resolved_at: null }, { resolved_at: '2026-04-18T10:00:00Z' })
    expect(diff.changed).toEqual([
      { key: 'resolved_at', before: null, after: '2026-04-18T10:00:00Z' },
    ])
  })

  it('sorts output arrays by key for stable rendering', () => {
    const diff = diffSnapshots(
      { z: 1, a: 1, m: 1 },
      { z: 2, a: 2, m: 2 },
    )
    expect(diff.changed.map((c) => c.key)).toEqual(['a', 'm', 'z'])
  })
})

describe('formatDiffValue', () => {
  it('formats primitives legibly', () => {
    expect(formatDiffValue('open')).toBe('open')
    expect(formatDiffValue(42)).toBe('42')
    expect(formatDiffValue(true)).toBe('true')
    expect(formatDiffValue(null)).toBe('null')
    expect(formatDiffValue(undefined)).toBe('—')
  })

  it('formats objects and arrays via JSON', () => {
    expect(formatDiffValue({ a: 1 })).toBe('{"a":1}')
    expect(formatDiffValue(['a', 'b'])).toBe('["a","b"]')
  })
})
