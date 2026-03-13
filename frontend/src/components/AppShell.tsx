import {
  Alignment,
  Callout,
  Menu,
  MenuItem,
  Navbar,
  NavbarDivider,
  NavbarGroup,
  NavbarHeading,
} from '@blueprintjs/core'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useReplay } from '../context/ReplayContext'
import ReplaySelector from './ReplaySelector'

export default function AppShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { isReplaying, asOf } = useReplay()

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
          </Menu>
        </nav>

        <main className="shell-main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
