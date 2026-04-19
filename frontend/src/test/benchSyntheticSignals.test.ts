import { describe, it, expect, afterEach } from 'vitest'
import { buildSyntheticBenchSignals, readBenchSignalCount } from '../lib/benchSyntheticSignals'

describe('benchSyntheticSignals', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  describe('buildSyntheticBenchSignals', () => {
    it('produces the requested count', () => {
      const signals = buildSyntheticBenchSignals(1_000)
      expect(signals).toHaveLength(1_000)
    })

    it('is deterministic — two invocations produce identical output', () => {
      const first = buildSyntheticBenchSignals(500)
      const second = buildSyntheticBenchSignals(500)
      expect(second).toEqual(first)
    })

    it('returns valid Signal shape with unique ids', () => {
      const signals = buildSyntheticBenchSignals(100)
      const ids = new Set<string>()
      for (const signal of signals) {
        expect(signal.signal_type).toBe('vessel_position')
        expect(signal.source).toBe('ais')
        expect(typeof signal.lat).toBe('number')
        expect(typeof signal.lng).toBe('number')
        expect(signal.lat as number).toBeGreaterThanOrEqual(-60)
        expect(signal.lat as number).toBeLessThanOrEqual(60)
        expect(signal.lng as number).toBeGreaterThanOrEqual(-180)
        expect(signal.lng as number).toBeLessThanOrEqual(180)
        expect(signal.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        ids.add(signal.id)
      }
      expect(ids.size).toBe(100)
    })

    it('returns empty array when count is zero', () => {
      expect(buildSyntheticBenchSignals(0)).toEqual([])
    })
  })

  describe('readBenchSignalCount', () => {
    it('returns null when the flag is unset', () => {
      expect(readBenchSignalCount()).toBeNull()
    })

    it('returns a positive integer when the flag is a valid number', () => {
      window.localStorage.setItem('resilience.perf.bench_signal_count', '10000')
      expect(readBenchSignalCount()).toBe(10_000)
    })

    it('floors non-integer values', () => {
      window.localStorage.setItem('resilience.perf.bench_signal_count', '1500.9')
      expect(readBenchSignalCount()).toBe(1_500)
    })

    it('returns null for non-numeric or non-positive values', () => {
      window.localStorage.setItem('resilience.perf.bench_signal_count', 'abc')
      expect(readBenchSignalCount()).toBeNull()
      window.localStorage.setItem('resilience.perf.bench_signal_count', '0')
      expect(readBenchSignalCount()).toBeNull()
      window.localStorage.setItem('resilience.perf.bench_signal_count', '-100')
      expect(readBenchSignalCount()).toBeNull()
    })
  })
})
