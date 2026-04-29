// ---------------------------------------------------------------------------
// EntityCard — unified Palantir-style object view for any first-class entity.
//
// Usage:
//   <EntityCard entityType="task"  entityId={id} />
//   <EntityCard entityType="asset" entityId={id} />
//   <EntityCard entityType="site"  entityId={id} />
//   <EntityCard entityType="ao"    entityId={id} />
//
// Tabs: Overview | Activity | Relations | Raw
// Each entity type renders its own Overview and Relations content via
// the panels in `entity-card/`. Activity (AuditTimeline) and Raw (JSON)
// are shared.
// ---------------------------------------------------------------------------

import { Callout, Tab, Tabs } from '@blueprintjs/core'
import AuditTimeline from './AuditTimeline'
import { useReplay } from '../context/ReplayContext'
import { AUDIT_ENTITY_TYPE, type EntityType } from './entity-card/internals'
import { TaskOverview, AssetOverview, SiteOverview, AoOverview } from './entity-card/Overviews'
import { TaskRelations, AssetRelations, SiteRelations, AoRelations } from './entity-card/Relations'
import { RawPanel } from './entity-card/RawPanel'

export type { EntityType }

export interface EntityCardProps {
  entityType: EntityType
  entityId:   string
}

export default function EntityCard({ entityType, entityId }: EntityCardProps) {
  const { isReplaying, asOf } = useReplay()
  const auditType = AUDIT_ENTITY_TYPE[entityType]

  function overviewPanel() {
    switch (entityType) {
      case 'task':  return <TaskOverview  key={entityId} taskId={entityId}  asOf={asOf} />
      case 'asset': return <AssetOverview key={entityId} assetId={entityId} asOf={asOf} />
      case 'site':  return <SiteOverview  key={entityId} siteId={entityId}  asOf={asOf} />
      case 'ao':    return <AoOverview    key={entityId} aoId={entityId}    asOf={asOf} />
    }
  }

  function relationsPanel() {
    switch (entityType) {
      case 'task':  return <TaskRelations  key={entityId} taskId={entityId}  asOf={asOf} />
      case 'asset': return <AssetRelations key={entityId} assetId={entityId} asOf={asOf} />
      case 'site':  return <SiteRelations  key={entityId} siteId={entityId}  asOf={asOf} />
      case 'ao':    return <AoRelations    key={entityId} aoId={entityId}    asOf={asOf} />
    }
  }

  return (
    <div className="entity-card">
      {isReplaying && asOf && (
        <Callout intent="warning" icon="history" compact className="entity-replay-callout">
          Viewing entity state as it existed at the replay timestamp. Mutations remain disabled in replay.
        </Callout>
      )}
      <Tabs id={`entity-card-${entityId}`} renderActiveTabPanelOnly>
        <Tab
          id="overview"
          title="Overview"
          panel={<div className="entity-tab-panel">{overviewPanel()}</div>}
        />
        <Tab
          id="activity"
          title="Activity"
          panel={
            <div className="entity-tab-panel">
              <AuditTimeline entityType={auditType} entityId={entityId} asOf={asOf} />
            </div>
          }
        />
        <Tab
          id="relations"
          title="Relations"
          panel={<div className="entity-tab-panel">{relationsPanel()}</div>}
        />
        <Tab
          id="raw"
          title="Raw"
          panel={
            <div className="entity-tab-panel">
              <RawPanel entityType={entityType} entityId={entityId} asOf={asOf} />
            </div>
          }
        />
      </Tabs>
    </div>
  )
}
