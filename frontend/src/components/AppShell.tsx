import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useReplay } from '../context/ReplayContext'
import { useAuth } from '../context/AuthContext'
import { useRole } from '../hooks/useRole'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useAreasOfOperation } from '../hooks/useAreasOfOperation'
import { useSseEvents } from '../hooks/useSseEvents'
import { AppNavbar } from './shell/AppNavbar'
import { AppSidebar, AppBottomNav } from './shell/AppSidebar'
import { AppBanners } from './shell/AppBanners'
import GlobalSearch from './GlobalSearch'
import type { Posture } from '../api/types'

const POSTURE_RANK: Record<Posture, number> = { observe: 0, defensive: 1, weapons_free: 2 }
export default function AppShell() {
  const navigate = useNavigate()
  const { isReplaying, asOf } = useReplay()
  const { currentUser, logout } = useAuth()
  const { isCommander } = useRole()
  const queryClient = useQueryClient()
  const isOnline = useOnlineStatus()
  const [searchOpen, setSearchOpen] = useState(false)

  // Mission posture is live-only until AO history is replay-scoped.
  const { data: areasData } = useAreasOfOperation(undefined, { enabled: !isReplaying, staleTime: 60_000 })
  const areas = isReplaying ? [] : (areasData?.data ?? [])
  const missionPosture: Posture = areas.reduce<Posture>(
    (best, ao) => POSTURE_RANK[ao.posture] > POSTURE_RANK[best] ? ao.posture : best,
    'observe'
  )

  const { status: liveStatus } = useSseEvents({
    enabled: !!currentUser && !isReplaying,
    queryClient,
  })

  // Cmd+K / Ctrl+K — open global search
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const classLevel = (import.meta.env.VITE_CLASSIFICATION_LEVEL ?? 'UNCLASSIFIED').toUpperCase()
  const classLabel = classLevel === 'UNCLASSIFIED'
    ? 'UNCLASSIFIED // FOR DEMONSTRATION PURPOSES ONLY'
    : classLevel
  const classIntent =
    classLevel === 'SECRET' ? 'danger' :
    classLevel === 'CUI'    ? 'warning' :
                              'success'

  return (
    <div className="shell">
      <div className={`classification-banner classification-banner--${classIntent}`}>
        {classLabel}
      </div>

      <AppNavbar
        liveStatus={liveStatus}
        missionPosture={missionPosture}
        hasMissionPosture={areas.length > 0}
        isCommander={isCommander}
        userEmail={currentUser?.email}
        userRole={currentUser?.role}
        onSearchOpen={() => setSearchOpen(true)}
        onLogout={handleLogout}
      />

      <AppBanners isOnline={isOnline} isReplaying={isReplaying} asOf={asOf} />

      <GlobalSearch
        open={searchOpen}
        isCommander={isCommander}
        onClose={() => setSearchOpen(false)}
        onLogout={handleLogout}
      />

      <div className="shell-body">
        <AppSidebar />
        <main className="shell-main">
          <Outlet />
        </main>
      </div>

      <AppBottomNav />

      <div className={`classification-banner classification-banner--${classIntent}`}>
        {classLabel}
      </div>
    </div>
  )
}
