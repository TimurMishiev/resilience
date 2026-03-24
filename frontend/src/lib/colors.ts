/**
 * Design token colors — single source of truth for all hardcoded hex values.
 *
 * These mirror Blueprint v6's dark-theme intent colors so that custom chart
 * elements, progress bars, and inline styles stay visually consistent with
 * Blueprint components without importing the full CSS bundle at runtime.
 */
export const COLORS = {
  // Intent colors (match Blueprint dark theme)
  success: '#23a26d',
  danger:  '#cd4246',
  warning: '#f0b726',
  primary: '#4580e6',
  orange:  '#e07b26',  // between warning and danger (risk: high)

  // Neutral / text
  muted:  '#8a9ba8',   // bp6-text-muted equivalent
  subtle: '#5c7080',   // secondary muted

  // Dark-theme chart surfaces
  chartBg:     '#252c35',
  chartBorder: '#383e47',
  chartGrid:   '#2f363f',
} as const

export type ColorKey = keyof typeof COLORS
