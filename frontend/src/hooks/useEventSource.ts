import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface SseEvent {
  event: string
  data: unknown
}

interface Options {
  onEvent?: (e: SseEvent) => void
  enabled?: boolean
}

/**
 * Opens a persistent SSE connection to /api/events.
 *
 * Security: Fetches a short-lived (60s) SSE token from POST /api/sse_token
 * before opening the EventSource. This avoids passing the long-lived 24h JWT
 * as a URL query parameter where it would be visible in proxy/access logs.
 *
 * Automatically reconnects with exponential back-off on failure.
 */
export function useEventSource({ onEvent, enabled = true }: Options = {}) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const esRef      = useRef<EventSource | null>(null)
  const retryRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const delayRef   = useRef(1000)   // initial retry delay ms
  const onEventRef = useRef(onEvent)

  // Keep callback ref fresh without re-connecting
  useEffect(() => { onEventRef.current = onEvent }, [onEvent])

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    async function connect() {
      try {
        setStatus('connecting')

        // Exchange the long-lived JWT for a short-lived (60s) SSE-only token.
        // The SSE token is scoped to the stream endpoint only — it cannot be
        // used to call any other API endpoint.
        const { token } = await api.post<{ token: string; expires_in: number }>(
          '/api/sse_token',
          {}
        )

        if (cancelled) return

        const url = `/api/events?token=${encodeURIComponent(token)}`
        const es  = new EventSource(url)
        esRef.current = es

        es.addEventListener('connected', () => {
          setStatus('connected')
          delayRef.current = 1000   // reset back-off on success
        })

        es.addEventListener('heartbeat', () => {
          // Heartbeats confirm the stream is alive — no action needed
        })

        // Listen for task mutation, correlation engine, alert workflow, and geofence events
        for (const evt of ['task_created', 'task_updated', 'task_transitioned', 'rule_fired', 'alert_transitioned', 'geofence_breach']) {
          es.addEventListener(evt, (e: MessageEvent) => {
            try {
              const data = JSON.parse(e.data)
              onEventRef.current?.({ event: evt, data })
            } catch { /* ignore parse errors */ }
          })
        }

        es.onerror = () => {
          es.close()
          esRef.current = null
          setStatus('disconnected')

          if (cancelled) return

          // Exponential back-off, capped at 30s
          retryRef.current = setTimeout(() => {
            delayRef.current = Math.min(delayRef.current * 2, 30_000)
            connect()
          }, delayRef.current)
        }
      } catch {
        if (cancelled) return
        setStatus('disconnected')
        retryRef.current = setTimeout(() => {
          delayRef.current = Math.min(delayRef.current * 2, 30_000)
          connect()
        }, delayRef.current)
      }
    }

    connect()

    return () => {
      cancelled = true
      esRef.current?.close()
      esRef.current = null
      if (retryRef.current) clearTimeout(retryRef.current)
      setStatus('disconnected')
    }
  }, [enabled])

  return { status }
}
