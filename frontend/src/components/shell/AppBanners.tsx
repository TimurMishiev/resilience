import { Callout } from '@blueprintjs/core'

interface Props {
  isOnline:    boolean
  isReplaying: boolean
  asOf:        string | null
}

export function AppBanners({ isOnline, isReplaying, asOf }: Props) {
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
    </>
  )
}
