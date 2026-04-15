import type { Task } from '../api/types'

/**
 * Human-readable relative time string from an ISO 8601 timestamp.
 * e.g. "3s ago", "12m ago", "2h 15m ago", "4d ago"
 */
export function timeAgo(iso: string, nowMs: number = Date.now()): string {
  const ms = nowMs - Date.parse(iso)
  if (ms < 0) return 'just now'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/**
 * Cardinal direction label for a heading in degrees (0° = North, 90° = East).
 */
export function headingLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(deg / 45) % 8]
}

/**
 * Format a Unix-seconds timestamp as a locale time string (HH:MM:SS).
 * Use for live telemetry where the date is always today.
 */
export function formatTimestampTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString()
}

/**
 * Format a Unix-seconds timestamp as a full locale date + time string.
 * Use when the timestamp may span multiple days (e.g. replay mode).
 */
export function formatTimestampFull(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

/**
 * Operational readiness score for a set of tasks.
 * Returns null when there are no tasks.
 * Weights: resolved tasks (60%) + non-blocked tasks (40%).
 */
export function computeReadiness(tasks: Task[]): number | null {
  const total = tasks.length
  if (total === 0) return null
  const resolved   = tasks.filter(t => t.workflow_status === 'resolved').length
  const nonBlocked = tasks.filter(t => t.workflow_status !== 'blocked').length
  return (resolved / total) * 0.6 + (nonBlocked / total) * 0.4
}
