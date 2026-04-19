import { NonIdealState } from '@blueprintjs/core'
import { humanize } from '../utils/humanize'
import { formatDiffValue, isDiffEmpty, type SnapshotDiff } from '../utils/diffSnapshots'

interface SnapshotDiffViewProps {
  diff: SnapshotDiff
  emptyTitle?: string
  emptyDescription?: string
}

function formatKey(key: string): string {
  return humanize(key)
}

export default function SnapshotDiffView({
  diff,
  emptyTitle = 'No field changes',
  emptyDescription = 'No stored fields changed between the two snapshots.',
}: SnapshotDiffViewProps) {
  if (isDiffEmpty(diff)) {
    return <NonIdealState icon="comparison" title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="snapshot-diff">
      {diff.changed.length > 0 && (
        <section className="snapshot-diff-section">
          <h4 className="bp6-heading snapshot-diff-heading">Changed</h4>
          <ul className="snapshot-diff-list">
            {diff.changed.map((entry) => (
              <li key={`c-${entry.key}`} className="snapshot-diff-row snapshot-diff-row--changed">
                <div className="snapshot-diff-key">{formatKey(entry.key)}</div>
                <div className="snapshot-diff-values">
                  <code className="snapshot-diff-before" data-testid="diff-before">
                    {formatDiffValue(entry.before)}
                  </code>
                  <span className="snapshot-diff-arrow" aria-hidden="true">→</span>
                  <code className="snapshot-diff-after" data-testid="diff-after">
                    {formatDiffValue(entry.after)}
                  </code>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {diff.added.length > 0 && (
        <section className="snapshot-diff-section">
          <h4 className="bp6-heading snapshot-diff-heading">Added</h4>
          <ul className="snapshot-diff-list">
            {diff.added.map((entry) => (
              <li key={`a-${entry.key}`} className="snapshot-diff-row snapshot-diff-row--added">
                <div className="snapshot-diff-key">{formatKey(entry.key)}</div>
                <div className="snapshot-diff-values">
                  <code className="snapshot-diff-after" data-testid="diff-after">
                    {formatDiffValue(entry.after)}
                  </code>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {diff.removed.length > 0 && (
        <section className="snapshot-diff-section">
          <h4 className="bp6-heading snapshot-diff-heading">Removed</h4>
          <ul className="snapshot-diff-list">
            {diff.removed.map((entry) => (
              <li key={`r-${entry.key}`} className="snapshot-diff-row snapshot-diff-row--removed">
                <div className="snapshot-diff-key">{formatKey(entry.key)}</div>
                <div className="snapshot-diff-values">
                  <code className="snapshot-diff-before" data-testid="diff-before">
                    {formatDiffValue(entry.before)}
                  </code>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
