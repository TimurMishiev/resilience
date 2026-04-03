import type { ChokepointCategory, ChokepointStatus, TaskPriority } from '../api/types'

export interface IntentDraft {
  title: string
  objective: string
  end_state: string
  constraints: string
}

export interface PaceDraft {
  primary_plan: string
  alternate_plan: string
  contingency_plan: string
  emergency_plan: string
  notes: string
}

export interface SaluteDraft {
  site_id: string
  size: string
  activity: string
  location: string
  unit: string
  observed_at: string
  equipment: string
  remarks: string
}

export interface ChokepointDraft {
  name: string
  category: ChokepointCategory
  status: ChokepointStatus
  latitude: string
  longitude: string
  watch_radius_km: string
  notes: string
}

export const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

export const PRIORITY_INTENT: Record<TaskPriority, 'danger' | 'warning' | 'primary' | 'none'> = {
  critical: 'danger',
  high: 'warning',
  normal: 'primary',
  low: 'none',
}

export const CHOKEPOINT_CATEGORY_OPTIONS: Array<{ value: ChokepointCategory; label: string }> = [
  { value: 'strait', label: 'Strait' },
  { value: 'canal', label: 'Canal' },
  { value: 'harbor_approach', label: 'Harbor approach' },
  { value: 'lane_constriction', label: 'Lane constriction' },
  { value: 'anchorage', label: 'Anchorage' },
]

export const CHOKEPOINT_STATUS_OPTIONS: Array<{ value: ChokepointStatus; label: string }> = [
  { value: 'monitor', label: 'Monitor' },
  { value: 'constrained', label: 'Constrained' },
  { value: 'contested', label: 'Contested' },
  { value: 'closed', label: 'Closed' },
]

export function makeDefaultObservedAt() {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
}

export function sameIntentDraft(left: IntentDraft, right: IntentDraft) {
  return left.title === right.title &&
    left.objective === right.objective &&
    left.end_state === right.end_state &&
    left.constraints === right.constraints
}

export function samePaceDraft(left: PaceDraft, right: PaceDraft) {
  return left.primary_plan === right.primary_plan &&
    left.alternate_plan === right.alternate_plan &&
    left.contingency_plan === right.contingency_plan &&
    left.emergency_plan === right.emergency_plan &&
    left.notes === right.notes
}

export function sameSaluteDraft(left: SaluteDraft, right: SaluteDraft) {
  return left.site_id === right.site_id &&
    left.size === right.size &&
    left.activity === right.activity &&
    left.location === right.location &&
    left.unit === right.unit &&
    left.observed_at === right.observed_at &&
    left.equipment === right.equipment &&
    left.remarks === right.remarks
}

export function sameChokepointDraft(left: ChokepointDraft, right: ChokepointDraft) {
  return left.name === right.name &&
    left.category === right.category &&
    left.status === right.status &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude &&
    left.watch_radius_km === right.watch_radius_km &&
    left.notes === right.notes
}
