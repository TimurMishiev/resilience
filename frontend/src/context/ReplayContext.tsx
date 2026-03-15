import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'

interface ReplayContextValue {
  asOf: string | null
  setAsOf: (value: string | null) => void
  isReplaying: boolean
}

const ReplayContext = createContext<ReplayContextValue | null>(null)

export function ReplayProvider({ children }: { children: ReactNode }) {
  const [asOf, setAsOf] = useState<string | null>(null)

  return (
    <ReplayContext.Provider value={{ asOf, setAsOf, isReplaying: asOf !== null }}>
      {children}
    </ReplayContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useReplay(): ReplayContextValue {
  const ctx = useContext(ReplayContext)
  if (!ctx) throw new Error('useReplay must be used inside ReplayProvider')
  return ctx
}
