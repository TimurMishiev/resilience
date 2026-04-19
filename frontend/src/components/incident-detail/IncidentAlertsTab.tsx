import { Button, HTMLTable, Icon, NonIdealState, Tag } from '@blueprintjs/core'
import { useState } from 'react'
import AlertChainDrawer from '../AlertChainDrawer'
import { SIGNAL_ICON_NAME } from '../../lib/signalIcons'
import { humanize } from '../../utils/humanize'
import type { IncidentAlert } from '../../api/incidents'

const ALERT_STATUS_INTENT: Record<string, 'danger' | 'warning' | 'primary' | 'success' | 'none'> = {
  unacknowledged: 'danger',
  acknowledged:   'warning',
  investigating:  'primary',
  closed:         'success',
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function IncidentAlertsTab({ alerts }: { alerts: IncidentAlert[] }) {
  const [chainMatch, setChainMatch] = useState<IncidentAlert | null>(null)

  if (alerts.length === 0) {
    return (
      <NonIdealState
        icon="shield"
        title="No alerts"
        description="No alerts are linked to this incident yet."
        className="tab-empty-state"
      />
    )
  }
  return (
    <>
      <AlertChainDrawer match={chainMatch} onClose={() => setChainMatch(null)} />
      <HTMLTable className="data-table" striped>
        <thead>
          <tr>
            <th>Rule / Source</th>
            <th>Signal</th>
            <th>Status</th>
            <th>Confidence</th>
            <th>Fired</th>
            <th style={{ width: 1 }}>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id}>
              <td>
                {a.geofence_breach
                  ? <Tag minimal intent="primary" icon="locate" style={{ fontSize: 10 }}>Geofence breach</Tag>
                  : <span>{a.correlation_rule?.name ?? <span className="bp6-text-muted">—</span>}</span>}
              </td>
              <td className="mono" style={{ fontSize: 12 }}>
                {a.signal ? (
                  <>
                    <Icon icon={SIGNAL_ICON_NAME[a.signal.signal_type] ?? 'dot'} size={12} style={{ marginRight: 5 }} />
                    {humanize(a.signal.signal_type)}
                  </>
                ) : <span className="bp6-text-muted">—</span>}
              </td>
              <td>
                <Tag minimal intent={ALERT_STATUS_INTENT[a.workflow_status] ?? 'none'} style={{ fontSize: 10 }}>
                  {a.workflow_status}
                </Tag>
              </td>
              <td className="mono">{Math.round(a.confidence * 100)}%</td>
              <td className="mono" style={{ fontSize: 11 }}>{fmt(a.fired_at)}</td>
              <td>
                <Button
                  icon="data-lineage"
                  minimal
                  small
                  onClick={() => setChainMatch(a)}
                  aria-label={`Show evidence for alert ${a.id}`}
                  title="Show evidence chain"
                >
                  Show evidence
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </>
  )
}
