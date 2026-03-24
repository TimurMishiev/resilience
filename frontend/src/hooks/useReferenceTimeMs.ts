import { useEffect, useState } from 'react'

export function useReferenceTimeMs(asOf?: string | null) {
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (asOf) return

    const refreshNow = () => setLiveNowMs(Date.now())
    const syncTimeout = window.setTimeout(refreshNow, 0)
    const intervalId = window.setInterval(refreshNow, 60_000)

    return () => {
      window.clearTimeout(syncTimeout)
      window.clearInterval(intervalId)
    }
  }, [asOf])

  return asOf ? new Date(asOf).getTime() : liveNowMs
}
