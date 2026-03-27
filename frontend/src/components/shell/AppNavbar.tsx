import {
  Alignment,
  Button,
  NavbarGroup,
  NavbarHeading,
  NavbarDivider,
  Navbar,
  Tag,
} from '@blueprintjs/core'
import ReplaySelector from '../ReplaySelector'
import type { ConnectionStatus } from '../../hooks/useEventSource'
import type { Posture } from '../../api/types'
import { POSTURE_LABELS } from '../../utils/humanize'

interface Props {
  liveStatus:       ConnectionStatus
  missionPosture:   Posture
  hasMissionPosture: boolean
  isCommander:      boolean
  userEmail:        string | undefined
  userRole:         string | undefined
  onSearchOpen:     () => void
  onLogout:         () => void
}

export function AppNavbar({
  liveStatus,
  missionPosture,
  hasMissionPosture,
  isCommander,
  userEmail,
  userRole,
  onSearchOpen,
  onLogout,
}: Props) {
  return (
    <Navbar className="shell-navbar">
      <NavbarGroup align={Alignment.LEFT}>
        <NavbarHeading className="shell-brand">RESILIENCE</NavbarHeading>
        <NavbarDivider />
        <span className="bp6-text-muted shell-tagline">Mission Operations Console</span>
      </NavbarGroup>
      <NavbarGroup align={Alignment.RIGHT}>
        <span
          className={`live-indicator live-indicator--${liveStatus}`}
          title={`Stream: ${liveStatus}`}
        />
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
