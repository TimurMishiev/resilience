import { Tag } from '@blueprintjs/core'
import type { Posture } from '../api/types'

const POSTURE_LABELS: Record<Posture, string> = {
  observe:      'Observe',
  defensive:    'Defensive',
  weapons_free: 'Weapons Free',
}

// Using explicit hex colors matching Blueprint's dark-theme palette since
// Blueprint doesn't have a named intent that maps cleanly to all three states.
const POSTURE_COLORS: Record<Posture, string> = {
  observe:      '#5c7080',  // Blueprint grey (muted — ROE is restrictive)
  defensive:    '#d9822b',  // Blueprint amber/orange
  weapons_free: '#db3737',  // Blueprint red (maximum alert)
}

interface Props {
  posture: Posture
  minimal?: boolean
}

export function PostureBadge({ posture, minimal = true }: Props) {
  return (
    <Tag
      minimal={minimal}
      style={{ backgroundColor: minimal ? undefined : POSTURE_COLORS[posture], color: minimal ? POSTURE_COLORS[posture] : '#fff', fontWeight: 600, letterSpacing: '0.03em' }}
      title={`ROE Posture: ${POSTURE_LABELS[posture]}`}
    >
      {POSTURE_LABELS[posture]}
    </Tag>
  )
}
