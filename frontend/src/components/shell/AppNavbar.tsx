import {
  Alignment,
  Button,
  NavbarGroup,
  NavbarHeading,
  NavbarDivider,
  Navbar,
  Tag,
  Tooltip,
} from '@blueprintjs/core'
import ReplaySelector from '../ReplaySelector'
import type { SourceHealthState } from '../../hooks/useSourceHealth'
import type { FreshnessState } from '../../lib/freshness'
import type { Posture } from '../../api/types'
import { POSTURE_LABELS } from '../../utils/humanize'

const FRESHNESS_CSS: Record<FreshnessState, string> = {
  fresh:       'live-indicator--connected',
  aging:       'live-indicator--connecting',
  stale:       'live-indicator--disconnected',
  unavailable: 'live-indicator--disconnected',
}

const FRESHNESS_LABEL: Record<FreshnessState, string> = {
  fresh:       'All sources healthy',
  aging:       'Data may be delayed',
  stale:       'Data is stale',
  unavailable: 'No data available',
}

const SOURCE_LABELS: Record<FreshnessState, string> = {
  fresh:       'Healthy',
  aging:       'Delayed',
  stale:       'Stale',
  unavailable: 'Unavailable',
}

interface Props {
  sourceHealth:     SourceHealthState
  missionPosture:   Posture
  hasMissionPosture: boolean
  isCommander:      boolean
  userEmail:        string | undefined
  userRole:         string | undefined
  onSearchOpen:     () => void
  onLogout:         () => void
}

export function AppNavbar({
  sourceHealth,
  missionPosture,
  hasMissionPosture,
  isCommander,
  userEmail,
  userRole,
  onSearchOpen,
  onLogout,
}: Props) {
  const sourceHealthTooltip = (
    <div style={{ fontSize: 12, lineHeight: 1.5 }}>
      <div><strong>System freshness</strong></div>
      <div>Overall: {FRESHNESS_LABEL[sourceHealth.aggregate]}</div>
      <div>Event stream: {SOURCE_LABELS[sourceHealth.sse]}</div>
      <div>Data refresh: {SOURCE_LABELS[sourceHealth.data]}</div>
    </div>
  )

  return (
    <Navbar className="shell-navbar">
      <NavbarGroup align={Alignment.LEFT}>
        <NavbarHeading className="shell-brand">RESILIENCE</NavbarHeading>
        <NavbarDivider />
        <span className="bp6-text-muted shell-tagline">Mission Operations Console</span>
      </NavbarGroup>
      <NavbarGroup align={Alignment.RIGHT}>
        <Tooltip content={sourceHealthTooltip} placement="bottom">
          <span
            className={`live-indicator ${FRESHNESS_CSS[sourceHealth.aggregate]}`}
            title={FRESHNESS_LABEL[sourceHealth.aggregate]}
            aria-label={`System freshness: ${FRESHNESS_LABEL[sourceHealth.aggregate]}`}
            tabIndex={0}
            data-testid="source-health-indicator"
          />
        </Tooltip>
        {hasMissionPosture && (
          <Tag
            minimal={missionPosture === 'observe'}
            intent={
              missionPosture === 'weapons_free' ? 'danger' :
              missionPosture === 'defensive'    ? 'warning' :
                                                  'none'
            }
            icon="shield"
            style={{ marginRight: 8, fontSize: 11, cursor: 'default' }}
            title={`Mission posture: ${POSTURE_LABELS[missionPosture] ?? missionPosture} (highest active AO)`}
          >
            {POSTURE_LABELS[missionPosture] ?? missionPosture}
          </Tag>
        )}
        <Button
          minimal small icon="search"
          onClick={onSearchOpen}
          className="gs-nav-btn"
          title="Command palette (⌘K)"
        />
        <ReplaySelector />
        <NavbarDivider />
        {userEmail && (
          <div className="shell-user">
            <Tag minimal intent={isCommander ? 'warning' : 'none'} className="shell-role-tag">
              {userRole}
            </Tag>
            <span className="shell-email bp6-text-muted">{userEmail}</span>
            <Button minimal small icon="log-out" onClick={onLogout} title="Sign out" />
          </div>
        )}
      </NavbarGroup>
    </Navbar>
  )
}
