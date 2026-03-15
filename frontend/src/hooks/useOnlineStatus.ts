import { useEffect, useState } from 'react'

/**
 * Tracks browser online/offline status.
 * Returns true when the browser has a network connection.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const up   = () => setOnline(true)
    const down = () => setOnline(false)

    window.addEventListener('online',  up)
    window.addEventListener('offline', down)

    return () => {
      window.removeEventListener('online',  up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return online
}
