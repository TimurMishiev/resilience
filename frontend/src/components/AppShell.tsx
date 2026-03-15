import {
  Alignment,
  Button,
  Callout,
  Menu,
  MenuItem,
  Navbar,
  NavbarDivider,
  NavbarGroup,
  NavbarHeading,
  Tag,
} from '@blueprintjs/core'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useReplay } from '../context/ReplayContext'
import { useAuth } from '../context/AuthContext'
import ReplaySelector from './ReplaySelector'
import { useEventSource } from '../hooks/useEventSource'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import GlobalSearch from './GlobalSearch'

export default function AppShell() {
  const navigate    = useNavigate()
  const { pathname } = useLocation()
  const { isReplaying, asOf } = useReplay()
  const { currentUser, logout } = useAuth()
  const queryClient = useQueryClient()
  const [searchOpen, setSearchOpen] = useState(false)
  const isOnline = useOnlineStatus()

  const { status: liveStatus } = useEventSource({
    enabled: !!currentUser && !isReplaying,
    onEvent: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['readiness'] })
    },
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

  return (
    <div className="shell">
      <Navbar className="shell-navbar">
        <NavbarGroup align={Alignment.LEFT}>
          <NavbarHeading className="shell-brand">RESILIENCE</NavbarHeading>
          <NavbarDivider />
          <span className="bp6-text-muted shell-tagline">
            Mission Operations Console
          </span>
        </NavbarGroup>
        <NavbarGroup align={Alignment.RIGHT}>
          <span
            className={`live-indicator live-indicator--${liveStatus}`}
            title={`Stream: ${liveStatus}`}
          />
          <Button
            minimal
            small
            icon="search"
            onClick={() => setSearchOpen(true)}
            className="gs-nav-btn"
            title="Search (⌘K)"
          />
          <ReplaySelector />
          <NavbarDivider />
          {currentUser && (
            <div className="shell-user">
              <Tag
                minimal
                intent={currentUser.role === 'commander' ? 'warning' : 'none'}
                className="shell-role-tag"
              >
                {currentUser.role}
              </Tag>
              <span className="shell-email bp6-text-muted">{currentUser.email}</span>
              <Button
                minimal
                small
                icon="log-out"
                onClick={handleLogout}
                title="Sign out"
              />
            </div>
          )}
        </NavbarGroup>
      </Navbar>

      {!isOnline && (
        <Callout intent="danger" compact className="offline-banner">
          OFFLINE — displaying cached data. Mutations are disabled until connection is restored.
        </Callout>
      )}

      {isReplaying && asOf && (
        <Callout intent="warning" compact className="replay-banner">
          Viewing historical state as of {new Date(asOf).toLocaleString()} — data is read-only
        </Callout>
      )}

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      <div className="shell-body">
        <nav className="shell-sidebar">
          <Menu>
            <MenuItem
              icon="dashboard"
              text="Dashboard"
              active={pathname.startsWith('/dashboard')}
              onClick={() => navigate('/dashboard')}
            />
            <MenuItem
              icon="map-marker"
              text="Sites"
              active={pathname.startsWith('/sites')}
              onClick={() => navigate('/sites')}
            />
            <MenuItem
              icon="th-list"
              text="Tasks"
              active={pathname.startsWith('/tasks')}
              onClick={() => navigate('/tasks')}
            />
            <MenuItem
              icon="cube"
              text="Assets"
              active={pathname.startsWith('/assets')}
              onClick={() => navigate('/assets')}
            />
            <MenuItem
              icon="globe"
              text="Map"
              active={pathname.startsWith('/map')}
              onClick={() => navigate('/map')}
            />
            <MenuItem
              icon="predictive-analysis"
              text="Briefing"
              active={pathname.startsWith('/briefing')}
              onClick={() => navigate('/briefing')}
            />
          </Menu>
        </nav>

        <main className="shell-main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
