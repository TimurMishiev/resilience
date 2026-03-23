/** Replace all underscores with spaces: "in_progress" → "in progress" */
export function humanize(s: string): string {
  return s.replaceAll('_', ' ')
}
