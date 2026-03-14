import { useState } from 'react'
import {
  Button,
  Callout,
  Card,
  HTMLSelect,
  Spinner,
  Tag,
} from '@blueprintjs/core'
import { postAiSummary } from '../api/ai'
import { useReplay } from '../context/ReplayContext'
import type { AiSummaryType, AiSummaryResult } from '../api/types'

const SUMMARY_TYPE_OPTIONS: { label: string; value: AiSummaryType }[] = [
  { label: 'Site activity',       value: 'site_activity' },
  { label: 'Readiness change',    value: 'readiness_change' },
  { label: 'Leadership briefing', value: 'leadership_briefing' },
]

export default function BriefingPanel() {
  const { asOf } = useReplay()
  const [summaryType, setSummaryType] = useState<AiSummaryType>('leadership_briefing')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [result, setResult]           = useState<AiSummaryResult | null>(null)

  function generate() {
    setLoading(true)
    setError(null)
    setResult(null)

    postAiSummary({
      summary_type: summaryType,
      from: asOf ?? undefined,
    })
      .then(({ data }) => setResult(data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to generate briefing'))
      .finally(() => setLoading(false))
  }

  return (
    <div className="briefing-panel">
      <div className="briefing-controls">
        <HTMLSelect
          value={summaryType}
          onChange={(e) => setSummaryType(e.currentTarget.value as AiSummaryType)}
          options={SUMMARY_TYPE_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
          disabled={loading}
        />
        <Button
          intent="primary"
          icon="predictive-analysis"
          loading={loading}
          onClick={generate}
          text="Generate briefing"
        />
      </div>

      {loading && (
        <div className="briefing-loading">
          <Spinner size={20} />
          <span className="bp6-text-muted">Generating operational briefing…</span>
        </div>
      )}

      {error && (
        <Callout intent="danger" compact>{error}</Callout>
      )}

      {result && (
        <Card className="briefing-result">
          <p className="briefing-summary">{result.summary}</p>
          {result.citations.length > 0 && (
            <div className="briefing-citations">
              <span className="bp6-text-muted briefing-citations-label">
                Citations ({result.citations.length})
              </span>
              <div className="briefing-citation-tags">
                {result.citations.map((id) => (
                  <Tag key={id} minimal className="briefing-citation-tag">
                    {id.slice(0, 8)}…
                  </Tag>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
