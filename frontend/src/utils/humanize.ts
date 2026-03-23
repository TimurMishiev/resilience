/** Replace all underscores with spaces: "in_progress" → "in progress" */
export function humanize(s: string): string {
  return s.replaceAll('_', ' ')
}

export const POSTURE_LABELS: Record<string, string> = {
  observe:      'Observe',
  defensive:    'Defensive',
  weapons_free: 'Weapons Free',
}
