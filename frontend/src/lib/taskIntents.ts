import type { AssetStatus, WorkflowStatus } from '../api/types'
import type { Intent } from '@blueprintjs/core'

export function workflowIntent(status: WorkflowStatus): Intent {
  switch (status) {
    case 'blocked':     return 'danger'
    case 'resolved':    return 'success'
    case 'in_progress': return 'primary'
    case 'triaged':     return 'warning'
    default:            return 'none'
  }
}

export function priorityIntent(priority: string): Intent {
  switch (priority) {
    case 'critical': return 'danger'
    case 'high':     return 'warning'
    default:         return 'none'
  }
}

export function batteryIntent(pct: number): Intent {
  if (pct < 20) return 'danger'
  if (pct < 40) return 'warning'
  return 'success'
}

export function transitionIntent(status: WorkflowStatus): Intent {
  switch (status) {
    case 'resolved':    return 'success'
    case 'blocked':     return 'danger'
    case 'in_progress': return 'primary'
    default:            return 'none'
  }
}

export function assetStatusIntent(status: AssetStatus): Intent {
  switch (status) {
    case 'available': return 'success'
    case 'assigned':  return 'primary'
    case 'degraded':  return 'warning'
    case 'offline':   return 'danger'
  }
}
