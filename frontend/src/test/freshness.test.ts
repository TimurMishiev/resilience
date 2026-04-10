import { describe, expect, it } from 'vitest'
import {
  deriveFreshness,
  connectionToFreshness,
  worstFreshness,
  type FreshnessState,
} from '../lib/freshness'

describe('deriveFreshness', () => {
  const now = 1_000_000

  it('returns "unavailable" when lastUpdatedMs is 0', () => {
    expect(deriveFreshness(0, now)).toBe('unavailable')
  })

  it('returns "unavailable" when lastUpdatedMs is negative', () => {
    expect(deriveFreshness(-1, now)).toBe('unavailable')
  })

  it('returns "fresh" when data was just updated', () => {
    expect(deriveFreshness(now, now)).toBe('fresh')
  })

  it('returns "fresh" when age is below aging threshold', () => {
    expect(deriveFreshness(now - 29_000, now)).toBe('fresh')
  })

  it('returns "aging" at exactly the aging threshold', () => {
    expect(deriveFreshness(now - 30_000, now)).toBe('aging')
  })

  it('returns "aging" between aging and stale thresholds', () => {
    expect(deriveFreshness(now - 60_000, now)).toBe('aging')
  })

  it('returns "stale" at exactly the stale threshold', () => {
    expect(deriveFreshness(now - 120_000, now)).toBe('stale')
  })

  it('returns "stale" when data is very old', () => {
    expect(deriveFreshness(now - 999_999, now)).toBe('stale')
  })

  it('returns "fresh" when lastUpdatedMs is in the future (clock skew)', () => {
    expect(deriveFreshness(now + 5_000, now)).toBe('fresh')
  })

  it('respects custom thresholds', () => {
    const thresholds = { agingMs: 5_000, staleMs: 10_000 }
    expect(deriveFreshness(now - 4_000, now, thresholds)).toBe('fresh')
    expect(deriveFreshness(now - 5_000, now, thresholds)).toBe('aging')
    expect(deriveFreshness(now - 10_000, now, thresholds)).toBe('stale')
  })
})

describe('connectionToFreshness', () => {
  it('maps connected to fresh', () => {
    expect(connectionToFreshness('connected')).toBe('fresh')
  })

  it('maps connecting to aging', () => {
    expect(connectionToFreshness('connecting')).toBe('aging')
  })

  it('maps disconnected to stale', () => {
    expect(connectionToFreshness('disconnected')).toBe('stale')
  })
})

describe('worstFreshness', () => {
  it('returns "unavailable" for an empty array', () => {
    expect(worstFreshness([])).toBe('unavailable')
  })

  it('returns "fresh" when all sources are fresh', () => {
    expect(worstFreshness(['fresh', 'fresh'])).toBe('fresh')
  })

  it('returns the worst state from mixed inputs', () => {
    expect(worstFreshness(['fresh', 'aging'])).toBe('aging')
    expect(worstFreshness(['fresh', 'stale'])).toBe('stale')
    expect(worstFreshness(['aging', 'stale'])).toBe('stale')
  })

  it('returns "unavailable" if any source is unavailable', () => {
    expect(worstFreshness(['fresh', 'unavailable'])).toBe('unavailable')
  })

  it('handles a single element', () => {
    const states: FreshnessState[] = ['aging']
    expect(worstFreshness(states)).toBe('aging')
  })
})
