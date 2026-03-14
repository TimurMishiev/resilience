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
import { useReplay } from '../context/ReplayContext'
import { useAuth } from '../context/AuthContext'
import ReplaySelector from './ReplaySelector'

export default function AppShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { isReplaying, asOf } = useReplay()
  const { currentUser, logout } = useAuth()

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

      {isReplaying && asOf && (
        <Callout intent="warning" compact className="replay-banner">
          Viewing historical state as of {new Date(asOf).toLocaleString()} — data is read-only
        </Callout>
      )}

      <div className="shell-body">
        <nav className="shell-sidebar">
          <Menu>
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
