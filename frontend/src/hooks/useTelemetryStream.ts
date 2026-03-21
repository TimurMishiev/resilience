import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

export interface TelemetryReading {
  asset_id: string
  name:     string
  lat:      number
  lng:      number
  heading:  number
  speed:    number    // m/s
  battery:  number    // 0-100
  ts:       number    // unix seconds
}

// Map from asset_id → latest reading
export type TelemetryMap = Map<string, TelemetryReading>

/**
 * Opens a persistent SSE connection to /api/telemetry/stream.
 * Returns a Map of asset_id → latest TelemetryReading, updated every ~3s.
 * Automatically reconnects with exponential back-off on failure.
 *
 * Security: Fetches a short-lived (60s) SSE token from POST /api/sse_token
 * before opening the EventSource — same pattern as useEventSource. This avoids
 * passing the long-lived 24h JWT as a URL query parameter where it would be
 * visible in proxy/access logs.
 *
 * Pass enabled=false to suppress the connection (e.g. in replay mode).
 */
export function useTelemetryStream(enabled = true) {
  const [readings, setReadings] = useState<TelemetryMap>(new Map())
  const [connected, setConnected] = useState(false)
  const esRef    = useRef<EventSource | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const delayRef = useRef(1000)

  // Reset state when the stream is disabled.
  // Calling setState inside an effect body is intentional here: we want to
  // clear readings synchronously when `enabled` transitions to false.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!enabled) {
      setReadings(new Map())
      setConnected(false)
    }
  }, [enabled])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!enabled) return

    let mounted = true

    async function connect() {
      try {
        // Exchange the long-lived JWT for a short-lived (60s) SSE-only token.
        const { token } = await api.post<{ token: string; expires_in: number }>(
          '/api/sse_token',
          {}
        )

        if (!mounted) return

        const url = `/api/telemetry/stream?token=${encodeURIComponent(token)}`
        const es  = new EventSource(url)
        esRef.current = es

        es.addEventListener('connected', () => {
          setConnected(true)
          delayRef.current = 1000
        })

        es.addEventListener('heartbeat', () => {
          // Stream alive — no action needed
        })

        es.addEventListener('telemetry', (e: MessageEvent) => {
          try {
            const reading: TelemetryReading = JSON.parse(e.data)
            setReadings(prev => {
              const next = new Map(prev)
              next.set(reading.asset_id, reading)
              return next
            })
          } catch {
            // Ignore parse errors
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
        // Token exchange failed — retry with back-off
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
  }, [enabled])

  return { readings, connected }
}
