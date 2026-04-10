import { Callout } from '@blueprintjs/core'
import type { SourceHealthState } from '../../hooks/useSourceHealth'

interface Props {
  isOnline:     boolean
  isReplaying:  boolean
  asOf:         string | null
  sourceHealth: SourceHealthState
}

function degradedMessage(sourceHealth: SourceHealthState): string {
  if (sourceHealth.sse === 'stale' && sourceHealth.data === 'unavailable') {
    return 'live event stream disconnected and no recent data is available'
  }
  if (sourceHealth.data === 'unavailable') {
    return 'no recent data is available yet'
  }
  if (sourceHealth.sse === 'stale' && sourceHealth.data === 'stale') {
    return 'live event stream disconnected and data feed is stale'
  }
  if (sourceHealth.sse === 'stale') {
    return 'live event stream disconnected'
  }
  return 'data feed has not refreshed recently'
}

export function AppBanners({ isOnline, isReplaying, asOf, sourceHealth }: Props) {
  const degraded = sourceHealth.aggregate === 'stale' || sourceHealth.aggregate === 'unavailable'
  const aging    = sourceHealth.aggregate === 'aging'

  return (
    <>
      {!isOnline && (
        <Callout intent="danger" compact className="offline-banner">
          OFFLINE — displaying cached data. Mutations are disabled until connection is restored.
        </Callout>
      )}
      {isReplaying && asOf && (
        <Callout intent="warning" compact className="replay-banner">
          Viewing historical state as of {new Date(asOf).toLocaleString()} — data is read-only
        </Callout>
      )}
      {!isReplaying && degraded && (
        <Callout intent="warning" compact icon="warning-sign" className="degraded-banner">
          Data may be outdated — {degradedMessage(sourceHealth)}
        </Callout>
      )}
      {!isReplaying && !degraded && aging && (
        <Callout intent="primary" compact icon="time" className="degraded-banner">
          Some data sources are delayed — information may not reflect the latest state
        </Callout>
      )}
    </>
  )
}
