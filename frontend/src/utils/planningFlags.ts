import type { Task, Asset, PlanningIncidentStub } from '../api/types'

export type FlagType =
  | 'double_assigned'
  | 'weapons_free_no_assets'
  | 'critical_unassigned'

export interface OvercommitmentFlag {
  type:        FlagType
  label:       string
  assetId?:    string
  assetName?:  string
  aoId?:       string
  aoName?:     string
  incidentId?: string
}

// Returns one flag per asset that appears on more than one non-resolved task.
// Relies on task.asset_id (authoritative) rather than asset.status (can lag).
function detectDoubleAssignments(tasks: Task[]): OvercommitmentFlag[] {
  const byAsset = new Map<string, Task[]>()
  for (const task of tasks) {
    if (!task.asset_id || task.workflow_status === 'resolved') continue
    const existing = byAsset.get(task.asset_id) ?? []
    existing.push(task)
    byAsset.set(task.asset_id, existing)
  }

  const flags: OvercommitmentFlag[] = []
  for (const [assetId, assignedTasks] of byAsset) {
    if (assignedTasks.length > 1) {
      flags.push({
        type:      'double_assigned',
        assetId,
        label:     `Asset double-assigned: appears on ${assignedTasks.length} open tasks` +
                   ` (${assignedTasks.map(t => `"${t.title}"`).join(', ')})`,
      })
    }
  }
  return flags
}

// Returns one flag per weapons_free AO that has no available asset covering any of its tasks.
function detectWeaponsFreeNoAssets(tasks: Task[], assets: Asset[]): OvercommitmentFlag[] {
  const assetById = new Map(assets.map(a => [a.id, a]))

  // Group non-resolved tasks by AO where posture is weapons_free
  const aoTasks = new Map<string, { aoName: string; tasks: Task[] }>()
  for (const task of tasks) {
    if (task.workflow_status === 'resolved') continue
    if (task.ao_posture !== 'weapons_free' || !task.ao_id) continue
    const entry = aoTasks.get(task.ao_id) ?? { aoName: task.site_name ?? task.ao_id, tasks: [] }
    entry.tasks.push(task)
    aoTasks.set(task.ao_id, entry)
  }

  const flags: OvercommitmentFlag[] = []
  for (const [aoId, { aoName, tasks: aoTaskList }] of aoTasks) {
    const hasAvailableAsset = aoTaskList.some(t => {
      if (!t.asset_id) return false
      const asset = assetById.get(t.asset_id)
      return asset?.status === 'available'
    })
    if (!hasAvailableAsset) {
      flags.push({
        type:   'weapons_free_no_assets',
        aoId,
        aoName,
        label:  `Weapons Free AO "${aoName}" has no available asset assigned to any open task`,
      })
    }
  }
  return flags
}

// Returns one flag per critical or high incident with no assigned operator.
function detectCriticalUnassigned(incidents: PlanningIncidentStub[]): OvercommitmentFlag[] {
  return incidents
    .filter(i => (i.severity === 'critical' || i.severity === 'high') && i.assigned_to === null)
    .map(i => ({
      type:        'critical_unassigned' as FlagType,
      incidentId:  i.id,
      label:       `${i.severity.charAt(0).toUpperCase() + i.severity.slice(1)} incident "${i.title}" has no assigned operator`,
    }))
}

export function computeFlags(
  tasks:     Task[],
  assets:    Asset[],
  incidents: PlanningIncidentStub[],
): OvercommitmentFlag[] {
  return [
    ...detectDoubleAssignments(tasks),
    ...detectWeaponsFreeNoAssets(tasks, assets),
    ...detectCriticalUnassigned(incidents),
  ]
}
