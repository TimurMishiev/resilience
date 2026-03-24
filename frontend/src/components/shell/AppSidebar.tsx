import { Icon, Menu, MenuItem } from '@blueprintjs/core'
import { useLocation, useNavigate } from 'react-router-dom'
import { useRole } from '../../hooks/useRole'
import type { IconName } from '@blueprintjs/icons'
import { preloadGlobeExperience, preloadMapExperience } from '../../lib/preloadRoutes'

const BOTTOM_NAV_TABS: { icon: IconName; label: string; path: string }[] = [
  { icon: 'dashboard',    label: 'Dashboard', path: '/dashboard' },
  { icon: 'warning-sign', label: 'Incidents', path: '/incidents' },
  { icon: 'th-list',      label: 'Tasks',     path: '/tasks'     },
  { icon: 'globe',        label: 'Map',       path: '/map'       },
  { icon: 'graph',        label: 'Graph',     path: '/graph'     },
]

/** Lock icon shown on commander-only menu items for operators. */
function LockLabel() {
  return <Icon icon="lock" size={10} className="shell-menu-lock" />
}

const ignorePreloadFailure = () => {}

export function AppSidebar() {
  const navigate     = useNavigate()
  const { pathname } = useLocation()
  const { isCommander } = useRole()

  const preloadMap = () => { void preloadMapExperience().catch(ignorePreloadFailure) }
  const preloadGlobe = () => { void preloadGlobeExperience().catch(ignorePreloadFailure) }

  return (
    <nav className="shell-sidebar">
      <Menu>
        <MenuItem icon="dashboard"          text="Dashboard"       active={pathname.startsWith('/dashboard')}       onClick={() => navigate('/dashboard')} />
        <MenuItem icon="map-marker"         text="Sites"           active={pathname.startsWith('/sites')}           onClick={() => navigate('/sites')} />
        <MenuItem icon="th-list"            text="Tasks"           active={pathname.startsWith('/tasks')}           onClick={() => navigate('/tasks')} />
        <MenuItem icon="warning-sign"       text="Incidents"       active={pathname.startsWith('/incidents')}       onClick={() => navigate('/incidents')} />
        <MenuItem icon="notifications"      text="Alert Triage"    active={pathname.startsWith('/alerts')}          onClick={() => navigate('/alerts')} />
        <MenuItem icon="lightbulb"          text="Recommendations" active={pathname.startsWith('/recommendations')} onClick={() => navigate('/recommendations')} />
        <MenuItem icon="cube"               text="Assets"          active={pathname.startsWith('/assets')}          onClick={() => navigate('/assets')} />
        <MenuItem
          icon="globe"
          text="Map"
          active={pathname.startsWith('/map')}
          onClick={() => navigate('/map')}
          onMouseEnter={preloadMap}
          onFocus={preloadMap}
        />
        <MenuItem icon="graph"              text="Graph"           active={pathname.startsWith('/graph')}           onClick={() => navigate('/graph')} />
        <MenuItem
          icon="globe-network"
          text="Globe"
          active={pathname.startsWith('/globe')}
          onClick={() => navigate('/globe')}
          onMouseEnter={preloadGlobe}
          onFocus={preloadGlobe}
        />
        <MenuItem
          icon="predictive-analysis"
          text="Briefing"
          active={pathname.startsWith('/briefing')}
          onClick={() => navigate('/briefing')}
          labelElement={!isCommander ? <LockLabel /> : undefined}
        />
        <MenuItem icon="feed"      text="Signals" active={pathname.startsWith('/signals')} onClick={() => navigate('/signals')} />
        <MenuItem
          icon="lightning"
          text="Rules"
          active={pathname.startsWith('/rules')}
          onClick={() => navigate('/rules')}
          labelElement={!isCommander ? <LockLabel /> : undefined}
        />
        <MenuItem
          icon="polygon-filter"
          text="Areas"
          active={pathname.startsWith('/areas')}
          onClick={() => navigate('/areas')}
          labelElement={!isCommander ? <LockLabel /> : undefined}
        />
        {isCommander && (
          <MenuItem icon="gantt-chart" text="Planning" active={pathname.startsWith('/planning')} onClick={() => navigate('/planning')} />
        )}
      </Menu>
    </nav>
  )
}

export function AppBottomNav() {
  const navigate     = useNavigate()
  const { pathname } = useLocation()

  function handlePreload(path: string) {
    if (path === '/map') {
      void preloadMapExperience().catch(ignorePreloadFailure)
    } else if (path === '/globe') {
      void preloadGlobeExperience().catch(ignorePreloadFailure)
    }
  }

  return (
    <nav className="shell-bottom-nav" aria-label="Main navigation">
      {BOTTOM_NAV_TABS.map(tab => (
        <button
          key={tab.path}
          className={`shell-tab ${pathname.startsWith(tab.path) ? 'shell-tab--active' : ''}`}
          onClick={() => navigate(tab.path)}
          onMouseEnter={() => handlePreload(tab.path)}
          onFocus={() => handlePreload(tab.path)}
          aria-label={tab.label}
          aria-current={pathname.startsWith(tab.path) ? 'page' : undefined}
        >
          <Icon icon={tab.icon} size={20} />
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}
