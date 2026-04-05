import { useState } from 'react'
import {
  Button,
  Callout,
  Drawer,
  DrawerSize,
  FormGroup,
  HTMLTable,
  NumericInput,
  Spinner,
  Tag,
} from '@blueprintjs/core'
import { useMutation } from '@tanstack/react-query'
import { dryRunRule } from '../../api/correlation_rules'
import type { DryRunResult } from '../../api/correlation_rules'
import type { CorrelationRule } from '../../api/types'
import { humanize } from '../../utils/humanize'

interface DryRunDrawerProps {
  rule:    CorrelationRule | null
  onClose: () => void
}

export function DryRunDrawer({ rule, onClose }: DryRunDrawerProps) {
  const [hours,  setHours]  = useState(24)
  const [result, setResult] = useState<DryRunResult | null>(null)
  const [error,  setError]  = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: ({ id, h }: { id: string; h: number }) => dryRunRule(id, h),
    onSuccess: r  => { setResult(r); setError(null) },
    onError:   e  => setError((e as Error).message),
  })

  function handleClose() {
    setResult(null)
    setError(null)
    onClose()
  }

  return (
    <Drawer
      isOpen={Boolean(rule)}
      onClose={handleClose}
      title={`Dry Run — ${rule?.name ?? ''}`}
      size={DrawerSize.LARGE}
      position="right"
    >
      <div className="drawer-body">
        <p className="bp6-text-muted" style={{ marginTop: 0 }}>
          Simulates this rule against historical signals. No tasks will be created, no sites flagged.
        </p>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
          <FormGroup label="Look-back window (hours)" style={{ margin: 0 }}>
            <NumericInput
              value={hours}
              onValueChange={v => setHours(Math.max(1, Math.min(168, v)))}
              min={1} max={168} style={{ width: 100 }}
            />
          </FormGroup>
          <Button
            intent="primary" icon="play"
            loading={mutation.isPending}
            onClick={() => rule && mutation.mutate({ id: rule.id, h: hours })}
          >
            Run
          </Button>
        </div>

        {mutation.isPending && <Spinner size={20} />}

        {error && (
          <Callout intent="danger" compact style={{ marginBottom: 12 }}>{error}</Callout>
        )}

        {result && (
          <>
            <Callout
              intent={result.total_matches > 0 ? 'warning' : 'success'}
              style={{ marginBottom: 12 }}
            >
              <strong>{result.total_matches} match{result.total_matches !== 1 ? 'es' : ''}</strong>
              {' '}would have fired over the last {result.window_hours}h.
              {result.total_matches > 50 && ' Showing first 50.'}
            </Callout>

            {result.matches.length > 0 && (
              <HTMLTable className="data-table" striped style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Signal Type</th><th>Source</th><th>Site</th>
                    <th>Distance</th><th>Magnitude</th><th>Would Fire</th><th>Occurred</th>
                  </tr>
                </thead>
                <tbody>
                  {result.matches.map((m, i) => (
                    <tr key={i}>
                      <td className="mono">{humanize(m.signal_type)}</td>
                      <td className="mono">{m.source}</td>
                      <td>{m.site_name}</td>
                      <td className="mono">{m.distance_km.toFixed(1)} km</td>
                      <td className="mono">{m.magnitude != null ? Number(m.magnitude).toFixed(1) : '—'}</td>
                      <td>
                        {m.would_fire.map(a => (
                          <Tag key={a} minimal intent="warning" style={{ fontSize: 10, marginRight: 3 }}>
                            {humanize(a)}
                          </Tag>
                        ))}
                      </td>
                      <td className="mono">
                        {new Date(m.occurred_at).toLocaleString(undefined, {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </HTMLTable>
            )}
          </>
        )}
      </div>
    </Drawer>
  )
}
