import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Callout,
  Card,
  HTMLSelect,
  Icon,
  Spinner,
  Tag,
  Tooltip,
} from '@blueprintjs/core'
import { postAiSummary, exportBriefing } from '../api/ai'
import { useSites } from '../hooks/useSites'
import { useReplay } from '../context/ReplayContext'
import type { AiSummaryType, AiSummaryResult } from '../api/types'

const SUMMARY_TYPE_OPTIONS: { label: string; value: AiSummaryType }[] = [
  { label: 'Site activity',       value: 'site_activity' },
  { label: 'Readiness change',    value: 'readiness_change' },
  { label: 'Leadership briefing', value: 'leadership_briefing' },
]

// ── grounding badge ───────────────────────────────────────────────────────────

function GroundingBadge({ counts }: { counts: AiSummaryResult['context_counts'] }) {
  const total = counts.audit_events + counts.signals + counts.rule_fires

  const tooltipContent = (
    <div style={{ fontSize: 12 }}>
      <div>{counts.audit_events} audit events</div>
      <div>{counts.signals} intelligence signals</div>
      <div>{counts.rule_fires} rule fires</div>
    </div>
  )

  return (
    <Tooltip content={tooltipContent} placement="top">
      <div className="briefing-grounding">
        <Icon icon="database" size={11} color="#8a9ba8" />
        <span className="bp6-text-muted" style={{ fontSize: 11 }}>
          Grounded in {total} records
        </span>
        {counts.signals > 0 && (
          <Tag minimal intent="primary" style={{ fontSize: 10, lineHeight: '14px' }}>
            {counts.signals} signal{counts.signals !== 1 ? 's' : ''}
          </Tag>
        )}
        {counts.rule_fires > 0 && (
          <Tag minimal intent="warning" style={{ fontSize: 10, lineHeight: '14px' }}>
            {counts.rule_fires} alert{counts.rule_fires !== 1 ? 's' : ''}
          </Tag>
        )}
      </div>
    </Tooltip>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function BriefingPanel() {
  const { asOf }  = useReplay()
  const { data: sitesData } = useSites({ per_page: 100 })
  const sites     = sitesData?.data ?? []

  const [summaryType, setSummaryType] = useState<AiSummaryType>('leadership_briefing')
  const [siteId, setSiteId]           = useState<string>('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [result, setResult]           = useState<AiSummaryResult | null>(null)
  const [pdfLoading, setPdfLoading]   = useState(false)
  const [pdfError, setPdfError]       = useState<string | null>(null)

  // mountedRef guards async callbacks against setting state after unmount.
  // Initialized to false and set to true inside the effect so it survives
  // React 19 StrictMode's synthetic unmount/remount cycle in development.
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  function generate() {
    setLoading(true)
    setError(null)
    setResult(null)
    setPdfError(null)

    postAiSummary({
      summary_type: summaryType,
      site_id:      siteId || undefined,
      from:         asOf ?? undefined,
    })
      .then(({ data }) => { if (mountedRef.current) setResult(data) })
      .catch((err: unknown) => { if (mountedRef.current) setError(err instanceof Error ? err.message : 'Failed to generate briefing') })
      .finally(() => { if (mountedRef.current) setLoading(false) })
  }

  function handleExport() {
    if (!result) return
    setPdfLoading(true)
    setPdfError(null)

    const siteName = siteId ? sites.find(s => s.id === siteId)?.name : undefined

    exportBriefing({
      summary_type:   summaryType,
      summary:        result.summary,
      citations:      result.citations,
      context_counts: result.context_counts,
      site_name:      siteName,
    })
      .then(blob => {
        // Trigger browser download without navigating away
        const url  = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href     = url
        link.download = `briefing-${new Date().toISOString().slice(0, 16).replace('T', '-')}.pdf`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
      })
      .catch((err: unknown) => {
        if (mountedRef.current)
          setPdfError(err instanceof Error ? err.message : 'PDF export failed')
      })
      .finally(() => { if (mountedRef.current) setPdfLoading(false) })
  }

  return (
    <div className="briefing-panel">
      <div className="briefing-controls">
        {/* site selector */}
        <HTMLSelect
          value={siteId}
          onChange={e => setSiteId(e.currentTarget.value)}
          disabled={loading}
          style={{ minWidth: 160 }}
        >
          <option value="">All sites</option>
          {sites.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </HTMLSelect>

        {/* summary type selector */}
        <HTMLSelect
          value={summaryType}
          onChange={e => setSummaryType(e.currentTarget.value as AiSummaryType)}
          options={SUMMARY_TYPE_OPTIONS.map(o => ({ label: o.label, value: o.value }))}
          disabled={loading}
        />

        <Button
          intent="primary"
          icon="predictive-analysis"
          loading={loading}
          onClick={generate}
          text="Generate briefing"
        />

        {result && (
          <Button
            icon="export"
            loading={pdfLoading}
            onClick={handleExport}
            text="Export PDF"
            title="Download as classified PDF briefing"
          />
        )}
      </div>

      {/* context hint */}
      {siteId && (
        <p className="bp6-text-muted" style={{ fontSize: 11, marginTop: 6, marginBottom: 0 }}>
          Briefing will include audit trail, intelligence signals within 200 km, and rule fires for this site.
        </p>
      )}

      {loading && (
        <div className="briefing-loading">
          <Spinner size={20} />
          <span className="bp6-text-muted">Synthesising operational intelligence…</span>
        </div>
      )}

      {error && (
        <Callout intent="danger" compact style={{ marginTop: 12 }}>{error}</Callout>
      )}

      {pdfError && (
        <Callout intent="danger" compact style={{ marginTop: 12 }}>PDF export failed: {pdfError}</Callout>
      )}

      {result && (
        <Card className="briefing-result">
          {/* grounding metadata */}
          <GroundingBadge counts={result.context_counts} />

          <p className="briefing-summary">{result.summary}</p>

          {result.citations.length > 0 && (
            <div className="briefing-citations">
              <span className="bp6-text-muted briefing-citations-label">
                Audit citations ({result.citations.length})
              </span>
              <div className="briefing-citation-tags">
                {result.citations.map(id => (
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
