import { Spinner } from '@blueprintjs/core'
import { useTask } from '../../hooks/useTasks'
import { useAsset } from '../../hooks/useAssets'
import { useSite } from '../../hooks/useSite'
import { useAreaOfOperation } from '../../hooks/useAreasOfOperation'
import { replayParams, type EntityType } from './internals'

export function RawPanel({ entityType, entityId, asOf }: { entityType: EntityType; entityId: string; asOf?: string | null }) {
  const detailParams = replayParams(asOf)
  const taskQuery  = useTask(entityType === 'task'  ? entityId : undefined, detailParams)
  const assetQuery = useAsset(entityType === 'asset' ? entityId : undefined, detailParams)
  const siteQuery  = useSite(entityType === 'site'  ? entityId : undefined, detailParams)
  const aoQuery    = useAreaOfOperation(entityType === 'ao' ? entityId : undefined, detailParams)

  const data = entityType === 'task'  ? taskQuery.data
             : entityType === 'asset' ? assetQuery.data
             : entityType === 'site'  ? siteQuery.data
             : aoQuery.data

  if (!data) return <Spinner size={20} style={{ marginTop: 24 }} />

  return <pre className="entity-raw">{JSON.stringify(data, null, 2)}</pre>
}
