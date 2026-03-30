import { Icon, Menu, MenuItem } from '@blueprintjs/core'
import { useLocation, useNavigate } from 'react-router-dom'
import { useRole } from '../../hooks/useRole'
import type { IconName } from '@blueprintjs/icons'
import {
  preloadGlobeExperience,
  preloadGlobePage,
  preloadMapExperience,
  preloadMapPage,
} from '../../lib/preloadRoutes'
import { buildMapGlobeSelectionPath } from '../../lib/entitySelectionRoute'

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
  const { pathname, search } = useLocation()
  const { isCommander } = useRole()
  const preserveEntitySelection = pathname.startsWith('/map') || pathname.startsWith('/globe')

  const preloadMapPageOnly = () => { void preloadMapPage().catch(ignorePreloadFailure) }
  const preloadGlobePageOnly = () => { void preloadGlobePage().catch(ignorePreloadFailure) }
  const preloadMapRuntime = () => { void preloadMapExperience().catch(ignorePreloadFailure) }
  const preloadGlobeRuntime = () => { void preloadGlobeExperience().catch(ignorePreloadFailure) }
  const mapPath = preserveEntitySelection ? buildMapGlobeSelectionPath('/map', search) : '/map'
  const globePath = preserveEntitySelection ? buildMapGlobeSelectionPath('/globe', search) : '/globe'

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
          onClick={() => navigate(mapPath)}
          onMouseEnter={preloadMapPageOnly}
          onFocus={preloadMapPageOnly}
          onPointerDown={preloadMapRuntime}
        />
        <MenuItem icon="graph"              text="Graph"           active={pathname.startsWith('/graph')}           onClick={() => navigate('/graph')} />
        <MenuItem
          icon="globe-network"
          text="Globe"
          active={pathname.startsWith('/globe')}
          onClick={() => navigate(globePath)}
          onMouseEnter={preloadGlobePageOnly}
          onFocus={preloadGlobePageOnly}
          onPointerDown={preloadGlobeRuntime}
        />
        <MenuItem
          icon="predictive-analysis"
          text="Briefing"
          active={pathname.startsWith('/briefing')}
          onClick={() => navigate('/briefing')}
          labelElement={!isCommander ? <LockLabel /> : undefined}
        />
        <MenuItem
          icon="search"
          text="Ontology Query"
          active={pathname.startsWith('/ontology')}
          onClick={() => navigate('/ontology')}
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
        <MenuItem icon="timeline-events" text="Swimlane" active={pathname.startsWith('/swimlane')} onClick={() => navigate('/swimlane')} />
      </Menu>
    </nav>
  )
}

export function AppBottomNav() {
  const navigate     = useNavigate()
  const { pathname, search } = useLocation()
  const preserveEntitySelection = pathname.startsWith('/map') || pathname.startsWith('/globe')
  const mapPath = preserveEntitySelection ? buildMapGlobeSelectionPath('/map', search) : '/map'

  function handlePreload(path: string) {
    if (path === '/map') {
      void preloadMapPage().catch(ignorePreloadFailure)
    } else if (path === '/globe') {
      void preloadGlobePage().catch(ignorePreloadFailure)
    }
  }

  function handleStrongPreload(path: string) {
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
          onClick={() => navigate(tab.path === '/map' ? mapPath : tab.path)}
          onMouseEnter={() => handlePreload(tab.path)}
          onFocus={() => handlePreload(tab.path)}
          onPointerDown={() => handleStrongPreload(tab.path)}
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
