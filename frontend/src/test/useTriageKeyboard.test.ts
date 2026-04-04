import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useTriageKeyboard, type TriageKeyboardInput } from '../hooks/useTriageKeyboard'
import type { SignalRuleMatch } from '../api/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMatch(id: string): SignalRuleMatch {
  return {
    id,
    fired_at: '2026-01-01T00:00:00Z',
    confidence: 0.9,
    workflow_status: 'unacknowledged',
    acknowledged_at: null,
    acknowledged_by: null,
    notes: null,
    metadata: {},
    signal: { id: `sig-${id}`, source: 'manual' as const, signal_type: 'manual' as const },
    rule: { id: `rule-${id}`, name: 'Test Rule' },
    site: null,
  } as unknown as SignalRuleMatch
}

function pressKey(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

function pressKeyOnInput(key: string) {
  const input = document.createElement('input')
  document.body.appendChild(input)
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  document.body.removeChild(input)
}

const matches = [makeMatch('m1'), makeMatch('m2'), makeMatch('m3')]

function defaultProps(overrides: Partial<TriageKeyboardInput> = {}): TriageKeyboardInput {
  return {
    matches,
    enabled: true,
    onTransition: vi.fn(),
    scrollToIndex: vi.fn(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTriageKeyboard', () => {
  beforeEach(() => { vi.clearAllMocks() })

  // ── Navigation ──────────────────────────────────────────────────────────

  it('j focuses the first item when nothing is focused', () => {
    const props = defaultProps()
    const { result } = renderHook(() => useTriageKeyboard(props))

    act(() => pressKey('j'))
    expect(result.current.focusedIndex).toBe(0)
    expect(props.scrollToIndex).toHaveBeenCalledWith(0)
  })

  it('j advances to the next item', () => {
    const props = defaultProps()
    const { result } = renderHook(() => useTriageKeyboard(props))

    act(() => pressKey('j')) // → 0
    act(() => pressKey('j')) // → 1
    expect(result.current.focusedIndex).toBe(1)
  })

  it('j clamps at the last item', () => {
    const props = defaultProps()
    const { result } = renderHook(() => useTriageKeyboard(props))

    act(() => pressKey('j')) // → 0
    act(() => pressKey('j')) // → 1
    act(() => pressKey('j')) // → 2
    act(() => pressKey('j')) // stays 2
    expect(result.current.focusedIndex).toBe(2)
  })

  it('k focuses the first item when nothing is focused', () => {
    const props = defaultProps()
    const { result } = renderHook(() => useTriageKeyboard(props))

    act(() => pressKey('k'))
    expect(result.current.focusedIndex).toBe(0)
  })

  it('k moves to the previous item', () => {
    const props = defaultProps()
    const { result } = renderHook(() => useTriageKeyboard(props))

    act(() => pressKey('j')) // → 0
    act(() => pressKey('j')) // → 1
    act(() => pressKey('k')) // → 0
    expect(result.current.focusedIndex).toBe(0)
  })

  it('k clamps at the first item', () => {
    const props = defaultProps()
    const { result } = renderHook(() => useTriageKeyboard(props))

    act(() => pressKey('j')) // → 0
    act(() => pressKey('k')) // stays 0
    expect(result.current.focusedIndex).toBe(0)
  })

  // ── Transitions ─────────────────────────────────────────────────────────

  it('a triggers acknowledge transition on focused match', () => {
    const props = defaultProps()
    renderHook(() => useTriageKeyboard(props))

    act(() => pressKey('j')) // focus m1
    act(() => pressKey('a'))
    expect(props.onTransition).toHaveBeenCalledWith('m1', 'acknowledged')
  })

  it('i triggers investigate transition on focused match', () => {
    const props = defaultProps()
    renderHook(() => useTriageKeyboard(props))

    act(() => pressKey('j')) // focus m1
    act(() => pressKey('i'))
    expect(props.onTransition).toHaveBeenCalledWith('m1', 'investigating')
  })

  it('c triggers close transition on focused match', () => {
    const props = defaultProps()
    renderHook(() => useTriageKeyboard(props))

    act(() => pressKey('j')) // focus m1
    act(() => pressKey('c'))
    expect(props.onTransition).toHaveBeenCalledWith('m1', 'closed')
  })

  it('transition keys are no-ops when nothing is focused', () => {
    const props = defaultProps()
    renderHook(() => useTriageKeyboard(props))

    act(() => pressKey('a'))
    act(() => pressKey('i'))
    act(() => pressKey('c'))
    expect(props.onTransition).not.toHaveBeenCalled()
  })

  // ── Escape ──────────────────────────────────────────────────────────────

  it('Escape clears focus', () => {
    const props = defaultProps()
    const { result } = renderHook(() => useTriageKeyboard(props))

    act(() => pressKey('j')) // focus → 0
    act(() => pressKey('Escape'))
    expect(result.current.focusedIndex).toBeNull()
  })

  // ── Input guard ─────────────────────────────────────────────────────────

  it('ignores keystrokes originating from input elements', () => {
    const props = defaultProps()
    const { result } = renderHook(() => useTriageKeyboard(props))

    act(() => pressKeyOnInput('j'))
    expect(result.current.focusedIndex).toBeNull()
  })

  // ── Disabled state ──────────────────────────────────────────────────────

  it('ignores all keys when enabled is false', () => {
    const props = defaultProps({ enabled: false })
    const { result } = renderHook(() => useTriageKeyboard(props))

    act(() => pressKey('j'))
    expect(result.current.focusedIndex).toBeNull()
    expect(props.scrollToIndex).not.toHaveBeenCalled()
  })

  // ── Empty matches ───────────────────────────────────────────────────────

  it('ignores all keys when matches is empty', () => {
    const props = defaultProps({ matches: [] })
    const { result } = renderHook(() => useTriageKeyboard(props))

    act(() => pressKey('j'))
    expect(result.current.focusedIndex).toBeNull()
  })
})
