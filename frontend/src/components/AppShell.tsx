import {
  Alignment,
  Menu,
  MenuItem,
  Navbar,
  NavbarDivider,
  NavbarGroup,
  NavbarHeading,
} from '@blueprintjs/core'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

export default function AppShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <div className="shell">
      <Navbar className="shell-navbar">
        <NavbarGroup align={Alignment.LEFT}>
          <NavbarHeading className="shell-brand">RESILIENCE</NavbarHeading>
          <NavbarDivider />
          <span className="bp5-text-muted shell-tagline">
            Mission Operations Console
          </span>
        </NavbarGroup>
      </Navbar>

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
          </Menu>
        </nav>

        <main className="shell-main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
