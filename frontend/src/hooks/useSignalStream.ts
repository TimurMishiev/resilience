import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Signal, SignalType } from '../api/types'
import {
  LIVE_SIGNAL_LIMITS,
  mergeSignals,
  sortSignalsNewestFirst,
  type SignalMap,
} from '../lib/liveSignals'

interface UseSignalStreamOptions {
  limits?: Partial<Record<SignalType, number>>
  seedCursor?: string | null
}

function maxIsoTimestamp(left: string | null, right: string | null): string | null {
  if (!left) return right
  if (!right) return left
  return Date.parse(left) >= Date.parse(right) ? left : right
}

export function useSignalStream(enabled = true, options?: UseSignalStreamOptions) {
  const limits = useMemo(
    () => ({ ...LIVE_SIGNAL_LIMITS, ...(options?.limits ?? {}) }),
    [options?.limits],
  )

  const [signalsById, setSignalsById] = useState<SignalMap>(new Map())
  const [connected, setConnected] = useState(false)
  const [connectionId, setConnectionId] = useState(0)
  const esRef = useRef<EventSource | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const delayRef = useRef(1000)
  const latestSeenRef = useRef<string | null>(options?.seedCursor ?? null)

  useEffect(() => {
    latestSeenRef.current = maxIsoTimestamp(latestSeenRef.current, options?.seedCursor ?? null)
  }, [options?.seedCursor])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!enabled) {
      setSignalsById(new Map())
      setConnected(false)
      setConnectionId(0)
      latestSeenRef.current = options?.seedCursor ?? null
    }
  }, [enabled, options?.seedCursor])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!enabled) return

    let mounted = true

    async function connect() {
      try {
        const { token } = await api.post<{ token: string; expires_in: number }>(
          '/api/sse_token',
          {},
        )

        if (!mounted) return

        const params = new URLSearchParams({ token })
        if (latestSeenRef.current) params.set('since', latestSeenRef.current)

        const es = new EventSource(`/api/signals/stream?${params.toString()}`)
        esRef.current = es

        es.addEventListener('connected', () => {
          setConnected(true)
          setConnectionId(previous => previous + 1)
          delayRef.current = 1000
        })

        es.addEventListener('heartbeat', () => {
          // Stream alive — no-op
        })

        es.addEventListener('signal', (event: MessageEvent) => {
          try {
            const signal: Signal = JSON.parse(event.data)
            latestSeenRef.current = maxIsoTimestamp(latestSeenRef.current, signal.ingested_at)
            setSignalsById(previous => mergeSignals(previous, [signal], limits))
          } catch {
            // ignore malformed payloads
          }
        })

        es.onerror = () => {
          es.close()
          esRef.current = null
          setConnected(false)

          if (!mounted) return

          retryRef.current = setTimeout(() => {
            delayRef.current = Math.min(delayRef.current * 2, 30_000)
            connect()
          }, delayRef.current)
        }
      } catch {
        if (!mounted) return

        retryRef.current = setTimeout(() => {
          delayRef.current = Math.min(delayRef.current * 2, 30_000)
          connect()
        }, delayRef.current)
      }
    }

    connect()

    return () => {
      mounted = false
      esRef.current?.close()
      esRef.current = null
      if (retryRef.current) clearTimeout(retryRef.current)
      setConnected(false)
    }
  }, [enabled, limits])

  const signals = useMemo(
    () => sortSignalsNewestFirst(Array.from(signalsById.values())),
    [signalsById],
  )

  return { signalsById, signals, connected, connectionId }
}
