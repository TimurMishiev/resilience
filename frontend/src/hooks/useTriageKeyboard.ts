/**
 * useTriageKeyboard
 *
 * Keyboard-driven alert triage: j/k to navigate, a/i/c to transition.
 * Designed for operator efficiency — hands never leave the keyboard.
 *
 * Keys:
 *   j — move focus to next alert
 *   k — move focus to previous alert
 *   a — acknowledge focused alert
 *   i — investigate focused alert
 *   c — close focused alert
 *   Escape — clear focus
 */

import { useCallback, useEffect, useState } from 'react'
import type { AlertStatus, SignalRuleMatch } from '../api/types'

export interface TriageKeyboardInput {
  matches:    SignalRuleMatch[]
  enabled:    boolean
  onTransition: (id: string, toStatus: AlertStatus) => void
  scrollToIndex?: (index: number) => void
}

export interface TriageKeyboardReturn {
  focusedIndex: number | null
  setFocusedIndex: (index: number | null) => void
}

export function useTriageKeyboard({
  matches,
  enabled,
  onTransition,
  scrollToIndex,
}: TriageKeyboardInput): TriageKeyboardReturn {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)

  // Reset focus when matches change (filter switch, new data)
  useEffect(() => {
    setFocusedIndex(null)
  }, [matches.length])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!enabled || matches.length === 0) return

    // Don't capture keys when typing in inputs/textareas
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

    switch (e.key) {
      case 'j': {
        e.preventDefault()
        const next = focusedIndex === null ? 0 : Math.min(focusedIndex + 1, matches.length - 1)
        setFocusedIndex(next)
        scrollToIndex?.(next)
        break
      }
      case 'k': {
        e.preventDefault()
        const prev = focusedIndex === null ? 0 : Math.max(focusedIndex - 1, 0)
        setFocusedIndex(prev)
        scrollToIndex?.(prev)
        break
      }
      case 'a': {
        if (focusedIndex === null) return
        e.preventDefault()
        const match = matches[focusedIndex]
        if (match) onTransition(match.id, 'acknowledged')
        break
      }
      case 'i': {
        if (focusedIndex === null) return
        e.preventDefault()
        const match = matches[focusedIndex]
        if (match) onTransition(match.id, 'investigating')
        break
      }
      case 'c': {
        if (focusedIndex === null) return
        e.preventDefault()
        const match = matches[focusedIndex]
        if (match) onTransition(match.id, 'closed')
        break
      }
      case 'Escape': {
        e.preventDefault()
        setFocusedIndex(null)
        break
      }
    }
  }, [enabled, focusedIndex, matches, onTransition, scrollToIndex])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return { focusedIndex, setFocusedIndex }
}
