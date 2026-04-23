import { useState } from 'react'
import { Button } from '@blueprintjs/core'
import DebriefPanel from '../DebriefPanel'
import { useRole } from '../../hooks/useRole'

/**
 * Inline debrief surface mounted inside the /map context aside. Renders the
 * shared DebriefPanel with `noNavigate` so a click on a reconstructable event
 * advances the shared ReplayContext as_of but keeps the operator on /map
 * (map enters replay at the event's time instead of yanking them to the
 * entity's detail page).
 *
 * Collapsed by default to avoid forcing layout when the operator is focused
 * on spatial work. Role-gated: only commanders (via useRole.canAccessDebrief)
 * see the toggle at all; viewer-role users get no expand/collapse affordance.
 *
 * This is the reduced-scope implementation of CTO P3 — one slice, one
 * component, reusing the shared replay state. A full-workstation variant
 * would split replay authority per panel and coordinate across panes; that
 * remains a separate decision (see memory/cto_evaluation_roadmap.md §P3).
 */
export function MapInlineDebriefPanel() {
  const role = useRole()
  const canAccessDebrief = role.canAccessDebrief ?? role.isCommander
  const [expanded, setExpanded] = useState(false)

  if (!canAccessDebrief) return null

  return (
    <div className="map-inline-debrief" data-testid="map-inline-debrief">
      <Button
        small
        minimal
        icon={expanded ? 'chevron-down' : 'chevron-right'}
        onClick={() => setExpanded((v) => !v)}
        data-testid="map-inline-debrief-toggle"
        aria-expanded={expanded}
        aria-controls="map-inline-debrief-body"
      >
        Debrief timeline
      </Button>
      {expanded && (
        <div
          id="map-inline-debrief-body"
          className="map-inline-debrief-body"
          data-testid="map-inline-debrief-body"
        >
          <DebriefPanel noNavigate />
        </div>
      )}
    </div>
  )
}
