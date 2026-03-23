import {
  Alignment,
  Button,
  Callout,
  Icon,
  Menu,
  MenuItem,
  Navbar,
  NavbarDivider,
  NavbarGroup,
  NavbarHeading,
  Tag,
} from '@blueprintjs/core'
import { AppToaster } from '../lib/toaster'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useReplay } from '../context/ReplayContext'
import { useAuth } from '../context/AuthContext'
import { useRole } from '../hooks/useRole'
import ReplaySelector from './ReplaySelector'
import { useEventSource } from '../hooks/useEventSource'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import GlobalSearch from './GlobalSearch'
import type { IconName } from '@blueprintjs/icons'
import { humanize, POSTURE_LABELS } from '../utils/humanize'

// Bottom nav tabs — shown on mobile only (hidden via CSS on desktop)
const TABS: { icon: IconName; label: string; path: string }[] = [
  { icon: 'dashboard',          label: 'Dashboard', path: '/dashboard' },
  { icon: 'warning-sign',       label: 'Incidents', path: '/incidents' },
  { icon: 'th-list',            label: 'Tasks',     path: '/tasks'     },
  { icon: 'globe',              label: 'Map',       path: '/map'       },
  { icon: 'graph',              label: 'Graph',     path: '/graph'     },
]

export default function AppShell() {
  const navigate     = useNavigate()
  const { pathname } = useLocation()
  const { isReplaying, asOf } = useReplay()
  const { currentUser, logout } = useAuth()
  const { isCommander } = useRole()
  const queryClient  = useQueryClient()
  const [searchOpen, setSearchOpen] = useState(false)
  const isOnline = useOnlineStatus()

  const { status: liveStatus } = useEventSource({
    enabled: !!currentUser && !isReplaying,
    onEvent: (e) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['readiness'] })
      queryClient.invalidateQueries({ queryKey: ['planning'] })

      if (e.event === 'rule_fired') {
        const d = e.data as {
          rule_name:       string
          site_name:       string
          task_title:      string | null
          priority:        string | null
          signal_type:     string
          distance_km:     number
          confidence:      number | null
          actions_taken:   string[]
        }
        // FusionService opens or updates an incident on every rule_fired event,
        // so incidents and recommendations are invalidated here alongside the
        // alert/rule/site surfaces.  geofence_breach does the same below.
        queryClient.invalidateQueries({ queryKey: ['signal_rule_matches'] })
        queryClient.invalidateQueries({ queryKey: ['correlation_rules'] })
        queryClient.invalidateQueries({ queryKey: ['sites'] })
        queryClient.invalidateQueries({ queryKey: ['incidents'] })
        queryClient.invalidateQueries({ queryKey: ['recommendations'] })
        const confPct = d.confidence != null ? ` · ${Math.round(d.confidence * 100)}% conf` : ''
        AppToaster.then(t => t.show({
          message: `⚡ ${d.rule_name} fired near ${d.site_name} — ${d.signal_type}, ${d.distance_km} km${confPct}`,
          intent:  'warning',
          icon:    'lightning',
          timeout: 10_000,
        }))
      }

      if (e.event === 'alert_transitioned') {
        const d = e.data as {
          workflow_status: string
          acknowledged_by: string
          rule_name:       string | null
          site_name:       string | null
          notes:           string | null
        }
        queryClient.invalidateQueries({ queryKey: ['signal_rule_matches'] })
        const STATUS_ICON: Record<string, string> = {
          acknowledged: '👁',
          investigating: '🔍',
          closed: '✔',
          unacknowledged: '⚠',
        }
        const label = humanize(d.workflow_status)
        const context = d.rule_name ?? 'alert'
        const site = d.site_name ? ` @ ${d.site_name}` : ''
        const notes = d.notes ? ` — "${d.notes}"` : ''
        AppToaster.then(t => t.show({
          message: `${STATUS_ICON[d.workflow_status] ?? '•'} ${context}${site} → ${label}${notes}`,
          intent:  d.workflow_status === 'closed' ? 'success' : d.workflow_status === 'investigating' ? 'primary' : 'none',
          icon:    d.workflow_status === 'closed' ? 'tick' : d.workflow_status === 'investigating' ? 'search' : 'eye-open',
          timeout: 6_000,
        }))
      }

      if (e.event === 'task_created') {
        const d = e.data as { title: string; priority: string; site_name: string | null }
        AppToaster.then(t => t.show({
          message: `✚ Task created: "${d.title}"${d.site_name ? ` @ ${d.site_name}` : ''} [${d.priority}]`,
          intent:  'success',
          icon:    'tick-circle',
          timeout: 6_000,
        }))
      }

      if (e.event === 'task_transitioned') {
        const d = e.data as { title: string; workflow_status: string; site_name: string | null }
        const STATUS_ICON: Record<string, string> = {
          resolved: '✔', blocked: '⛔', in_progress: '▶', triaged: '🔍', new: '•',
        }
        AppToaster.then(t => t.show({
          message: `${STATUS_ICON[d.workflow_status] ?? '•'} "${d.title}" → ${humanize(d.workflow_status)}${d.site_name ? ` @ ${d.site_name}` : ''}`,
          intent:  d.workflow_status === 'resolved' ? 'success' : d.workflow_status === 'blocked' ? 'danger' : 'none',
          icon:    d.workflow_status === 'resolved' ? 'tick' : d.workflow_status === 'blocked' ? 'ban-circle' : 'refresh',
          timeout: 6_000,
        }))
      }

      if (e.event === 'geofence_breach') {
        const d = e.data as { site_name: string; signal_type: string; distance_km: number }
        queryClient.invalidateQueries({ queryKey: ['incidents'] })
        queryClient.invalidateQueries({ queryKey: ['recommendations'] })
        AppToaster.then(t => t.show({
          message: `⚠ Geofence breach at ${d.site_name} — ${humanize(d.signal_type)} (${d.distance_km} km)`,
          intent:  'warning',
          icon:    'locate',
          timeout: 8_000,
        }))
      }

      if (e.event === 'posture_changed') {
        const d = e.data as { area_of_operation_id: string; name: string; posture: string }
        queryClient.invalidateQueries({ queryKey: ['areas_of_operation'] })
        queryClient.invalidateQueries({ queryKey: ['incidents'] })
        AppToaster.then(t => t.show({
          message: `🔰 ${d.name}: ROE posture → ${POSTURE_LABELS[d.posture] ?? d.posture}`,
          intent:  d.posture === 'weapons_free' ? 'danger' : d.posture === 'defensive' ? 'warning' : 'none',
          icon:    'shield',
          timeout: 10_000,
        }))
      }

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

  const classLevel = (import.meta.env.VITE_CLASSIFICATION_LEVEL ?? 'UNCLASSIFIED').toUpperCase()
  const classLabel = classLevel === 'UNCLASSIFIED'
    ? 'UNCLASSIFIED // FOR DEMONSTRATION PURPOSES ONLY'
    : classLevel
  const classIntent =
    classLevel === 'SECRET'      ? 'danger'  :
    classLevel === 'CUI'         ? 'warning' :
    /* UNCLASSIFIED / default */   'success'

  return (
    <div className="shell">
      <div className={`classification-banner classification-banner--${classIntent}`}>
        {classLabel}
      </div>
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
                intent={isCommander ? 'warning' : 'none'}
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
        {/* Desktop sidebar */}
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
              icon="warning-sign"
              text="Incidents"
              active={pathname.startsWith('/incidents')}
              onClick={() => navigate('/incidents')}
            />
            <MenuItem
              icon="notifications"
              text="Alert Triage"
              active={pathname.startsWith('/alerts')}
              onClick={() => navigate('/alerts')}
            />
            <MenuItem
              icon="lightbulb"
              text="Recommendations"
              active={pathname.startsWith('/recommendations')}
              onClick={() => navigate('/recommendations')}
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
              icon="graph"
              text="Graph"
              active={pathname.startsWith('/graph')}
              onClick={() => navigate('/graph')}
            />
            <MenuItem
              icon="globe-network"
              text="Globe"
              active={pathname.startsWith('/globe')}
              onClick={() => navigate('/globe')}
            />
            <MenuItem
              icon="predictive-analysis"
              text="Briefing"
              active={pathname.startsWith('/briefing')}
              onClick={() => navigate('/briefing')}
              labelElement={!isCommander
                ? <Icon icon="lock" size={10} className="shell-menu-lock" />
                : undefined
              }
            />
            <MenuItem
              icon="feed"
              text="Signals"
              active={pathname.startsWith('/signals')}
              onClick={() => navigate('/signals')}
            />
            <MenuItem
              icon="lightning"
              text="Rules"
              active={pathname.startsWith('/rules')}
              onClick={() => navigate('/rules')}
              labelElement={!isCommander
                ? <Icon icon="lock" size={10} className="shell-menu-lock" />
                : undefined
              }
            />
            <MenuItem
              icon="polygon-filter"
              text="Areas"
              active={pathname.startsWith('/areas')}
              onClick={() => navigate('/areas')}
              labelElement={!isCommander
                ? <Icon icon="lock" size={10} className="shell-menu-lock" />
                : undefined
              }
            />
            {isCommander && (
              <MenuItem
                icon="gantt-chart"
                text="Planning"
                active={pathname.startsWith('/planning')}
                onClick={() => navigate('/planning')}
              />
            )}
          </Menu>
        </nav>

        <main className="shell-main">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom tab bar — hidden on desktop via CSS */}
      <nav className="shell-bottom-nav" aria-label="Main navigation">
        {TABS.map(tab => (
          <button
            key={tab.path}
            className={`shell-tab ${pathname.startsWith(tab.path) ? 'shell-tab--active' : ''}`}
            onClick={() => navigate(tab.path)}
            aria-label={tab.label}
            aria-current={pathname.startsWith(tab.path) ? 'page' : undefined}
          >
            <Icon icon={tab.icon} size={20} />
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
      <div className={`classification-banner classification-banner--${classIntent}`}>
        {classLabel}
      </div>
    </div>
  )
}
