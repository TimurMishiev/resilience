import { COLORS } from '../../lib/colors'

export function scoreIntent(score: number | null) {
  if (score === null) return COLORS.subtle
  if (score >= 0.75) return COLORS.success
  if (score >= 0.5) return COLORS.warning
  return COLORS.danger
}

export function pct(n: number | null): string {
  if (n === null) return '—'
  return `${Math.round(n * 100)}%`
}
