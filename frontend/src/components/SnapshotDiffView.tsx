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
    <div className="debrief-diff">
      {diff.changed.length > 0 && (
        <section className="debrief-diff-section">
          <h4 className="bp6-heading debrief-diff-heading">Changed</h4>
          <ul className="debrief-diff-list">
            {diff.changed.map((entry) => (
              <li key={`c-${entry.key}`} className="debrief-diff-row debrief-diff-row--changed">
                <div className="debrief-diff-key">{formatKey(entry.key)}</div>
                <div className="debrief-diff-values">
                  <code className="debrief-diff-before" data-testid="diff-before">
                    {formatDiffValue(entry.before)}
                  </code>
                  <span className="debrief-diff-arrow" aria-hidden="true">→</span>
                  <code className="debrief-diff-after" data-testid="diff-after">
                    {formatDiffValue(entry.after)}
                  </code>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {diff.added.length > 0 && (
        <section className="debrief-diff-section">
          <h4 className="bp6-heading debrief-diff-heading">Added</h4>
          <ul className="debrief-diff-list">
            {diff.added.map((entry) => (
              <li key={`a-${entry.key}`} className="debrief-diff-row debrief-diff-row--added">
                <div className="debrief-diff-key">{formatKey(entry.key)}</div>
                <div className="debrief-diff-values">
                  <code className="debrief-diff-after" data-testid="diff-after">
                    {formatDiffValue(entry.after)}
                  </code>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {diff.removed.length > 0 && (
        <section className="debrief-diff-section">
          <h4 className="bp6-heading debrief-diff-heading">Removed</h4>
          <ul className="debrief-diff-list">
            {diff.removed.map((entry) => (
              <li key={`r-${entry.key}`} className="debrief-diff-row debrief-diff-row--removed">
                <div className="debrief-diff-key">{formatKey(entry.key)}</div>
                <div className="debrief-diff-values">
                  <code className="debrief-diff-before" data-testid="diff-before">
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
