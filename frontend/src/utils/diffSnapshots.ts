// Pure field-level diff between two audit-event snapshots.
//
// Operator-grade contract:
//   - `before` may be null (creation events).
//   - `after` is always present.
//   - Returned arrays are sorted by key for stable rendering.
//   - Key equality is strict JSON equality via `Object.is` for primitives and
//     structural `JSON.stringify` comparison for nested objects/arrays — audit
//     snapshots are JSON-serialisable by contract, so this is safe.

export interface DiffAdded {
  key: string
  after: unknown
}

export interface DiffRemoved {
  key: string
  before: unknown
}

export interface DiffChanged {
  key: string
  before: unknown
  after: unknown
}

export interface SnapshotDiff {
  added: DiffAdded[]
  removed: DiffRemoved[]
  changed: DiffChanged[]
}

function isEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

export function diffSnapshots(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): SnapshotDiff {
  const beforeObj = before ?? {}
  const afterObj = after ?? {}

  const added: DiffAdded[] = []
  const removed: DiffRemoved[] = []
  const changed: DiffChanged[] = []

  const keys = new Set<string>([...Object.keys(beforeObj), ...Object.keys(afterObj)])
  for (const key of keys) {
    const hadBefore = Object.prototype.hasOwnProperty.call(beforeObj, key)
    const hasAfter = Object.prototype.hasOwnProperty.call(afterObj, key)
    if (!hadBefore && hasAfter) {
      added.push({ key, after: afterObj[key] })
    } else if (hadBefore && !hasAfter) {
      removed.push({ key, before: beforeObj[key] })
    } else if (hadBefore && hasAfter && !isEqual(beforeObj[key], afterObj[key])) {
      changed.push({ key, before: beforeObj[key], after: afterObj[key] })
    }
  }

  added.sort((a, b) => a.key.localeCompare(b.key))
  removed.sort((a, b) => a.key.localeCompare(b.key))
  changed.sort((a, b) => a.key.localeCompare(b.key))

  return { added, removed, changed }
}

export function isDiffEmpty(diff: SnapshotDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0
}

export function formatDiffValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
