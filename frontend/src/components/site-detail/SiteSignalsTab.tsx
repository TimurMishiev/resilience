import { Callout, HTMLTable, Icon, NonIdealState, Spinner } from '@blueprintjs/core'
import { useSignals } from '../../hooks/useSignals'
import { SIGNAL_ICON_NAME } from '../../lib/signalIcons'
import { humanize } from '../../utils/humanize'
import type { Signal } from '../../api/types'

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function SiteSignalsTab({ siteId, asOf }: { siteId: string; asOf?: string | null }) {
  const { data, isPending, error } = useSignals({ site_id: siteId, per_page: 50, ...(asOf ? { as_of: asOf } : {}) }, { refetchInterval: asOf ? false : 5000 })

  if (isPending) return <Spinner size={20} style={{ marginTop: 24 }} />
  if (error) return <Callout intent="danger" compact>{error.message}</Callout>

  const signals = data?.data ?? []

  if (signals.length === 0) {
    return (
      <NonIdealState
        icon="signal-search"
        title="No signals"
        description="No signals detected near this site."
        className="tab-empty-state"
      />
    )
  }

  return (
    <HTMLTable className="data-table" striped>
      <thead>
        <tr>
          <th>Type</th>
          <th>Source</th>
          <th>Magnitude</th>
          <th>Lat / Lng</th>
          <th>Occurred</th>
        </tr>
      </thead>
      <tbody>
        {signals.map((s: Signal) => (
          <tr key={s.id}>
            <td>
              <Icon icon={SIGNAL_ICON_NAME[s.signal_type] ?? 'dot'} size={12} style={{ marginRight: 6 }} />
              {humanize(s.signal_type)}
            </td>
            <td className="mono">{s.source}</td>
            <td className="mono">{s.magnitude != null ? Number(s.magnitude).toFixed(2) : '—'}</td>
            <td className="mono">
              {Number(s.lat).toFixed(3)}, {Number(s.lng).toFixed(3)}
            </td>
            <td className="mono">{fmt(s.occurred_at)}</td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  )
}
