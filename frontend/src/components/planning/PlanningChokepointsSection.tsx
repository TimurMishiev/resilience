import type { Dispatch, SetStateAction } from 'react'
import {
  Button,
  Callout,
  Card,
  FormGroup,
  HTMLSelect,
  HTMLTable,
  InputGroup,
  Tag,
  TextArea,
} from '@blueprintjs/core'
import type { PlanningAoStub, Chokepoint, ChokepointCategory, ChokepointStatus } from '../../api/types'
import { humanize } from '../../utils/humanize'
import { CHOKEPOINT_CATEGORY_OPTIONS, CHOKEPOINT_STATUS_OPTIONS, type ChokepointDraft } from '../../lib/planningPageUtils'

interface Props {
  areasOfOperation: PlanningAoStub[]
  selectedDoctrineAoId: string
  selectedDoctrineAo: PlanningAoStub | null
  selectedChokepointId: string
  selectedChokepoint: Chokepoint | null
  doctrineChokepoints: Chokepoint[]
  pendingSelectedChokepoint: Chokepoint | null
  chokepointDraft: ChokepointDraft
  setChokepointDraft: Dispatch<SetStateAction<ChokepointDraft>>
  setSelectedChokepointId: (id: string) => void
  setPendingSelectedChokepoint: (value: Chokepoint | null) => void
  onDoctrineAoChange: (areaOfOperationId: string) => void
  onSave: () => void
  onDelete: () => void
  isReplaying: boolean
  saving: boolean
  deleting: boolean
  error: string | null
  notice: string | null
}

export function PlanningChokepointsSection({
  areasOfOperation,
  selectedDoctrineAoId,
  selectedDoctrineAo,
  selectedChokepointId,
  selectedChokepoint,
  doctrineChokepoints,
  pendingSelectedChokepoint,
  chokepointDraft,
  setChokepointDraft,
  setSelectedChokepointId,
  setPendingSelectedChokepoint,
  onDoctrineAoChange,
  onSave,
  onDelete,
  isReplaying,
  saving,
  deleting,
  error,
  notice,
}: Props) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h3 className="bp6-heading" style={{ fontSize: 14, marginBottom: 10, color: 'var(--bp6-text-muted-color)' }}>
        MARITIME CHOKEPOINTS
      </h3>
      {areasOfOperation.length === 0 ? (
        <Callout intent="warning" compact>
          Create an area of operation before recording monitored straits, canals, or harbor approaches.
        </Callout>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 420px) minmax(0, 1fr)', gap: 16 }}>
          <Card style={{ background: 'rgba(255,255,255,0.02)' }}>
            <FormGroup label="Area of operation" inline>
              <HTMLSelect
                fill
                value={selectedDoctrineAoId}
                onChange={event => onDoctrineAoChange(event.target.value)}
                options={areasOfOperation.map(ao => ({ label: ao.name, value: ao.id }))}
              />
            </FormGroup>
            <FormGroup label="Editing" labelFor="chokepoint-editing">
              <HTMLSelect
                id="chokepoint-editing"
                fill
                value={selectedChokepointId}
                onChange={event => {
                  setPendingSelectedChokepoint(null)
                  setSelectedChokepointId(event.target.value)
                }}
                options={[
                  { label: 'New chokepoint', value: '' },
                  ...(
                    pendingSelectedChokepoint &&
                    pendingSelectedChokepoint.area_of_operation_id === selectedDoctrineAoId &&
                    !doctrineChokepoints.some(point => point.id === pendingSelectedChokepoint.id)
                      ? [{ label: pendingSelectedChokepoint.name, value: pendingSelectedChokepoint.id }]
                      : []
                  ),
                  ...doctrineChokepoints.map(point => ({ label: point.name, value: point.id })),
                ]}
              />
            </FormGroup>
            <FormGroup label="Name" labelFor="chokepoint-name">
              <InputGroup
                id="chokepoint-name"
                value={chokepointDraft.name}
                onChange={event => setChokepointDraft(prev => ({ ...prev, name: event.target.value }))}
                placeholder="Hormuz outbound lane"
              />
            </FormGroup>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormGroup label="Category" labelFor="chokepoint-category">
                <HTMLSelect
                  id="chokepoint-category"
                  fill
                  value={chokepointDraft.category}
                  onChange={event => setChokepointDraft(prev => ({ ...prev, category: event.target.value as ChokepointCategory }))}
                  options={CHOKEPOINT_CATEGORY_OPTIONS.map(option => ({ label: option.label, value: option.value }))}
                />
              </FormGroup>
              <FormGroup label="Status" labelFor="chokepoint-status">
                <HTMLSelect
                  id="chokepoint-status"
                  fill
                  value={chokepointDraft.status}
                  onChange={event => setChokepointDraft(prev => ({ ...prev, status: event.target.value as ChokepointStatus }))}
                  options={CHOKEPOINT_STATUS_OPTIONS.map(option => ({ label: option.label, value: option.value }))}
                />
              </FormGroup>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <FormGroup label="Latitude" labelFor="chokepoint-latitude">
                <InputGroup
                  id="chokepoint-latitude"
                  value={chokepointDraft.latitude}
                  onChange={event => setChokepointDraft(prev => ({ ...prev, latitude: event.target.value }))}
                  placeholder="25.285447"
                />
              </FormGroup>
              <FormGroup label="Longitude" labelFor="chokepoint-longitude">
                <InputGroup
                  id="chokepoint-longitude"
                  value={chokepointDraft.longitude}
                  onChange={event => setChokepointDraft(prev => ({ ...prev, longitude: event.target.value }))}
                  placeholder="56.334457"
                />
              </FormGroup>
              <FormGroup label="Watch radius (km)" labelFor="chokepoint-radius">
                <InputGroup
                  id="chokepoint-radius"
                  value={chokepointDraft.watch_radius_km}
                  onChange={event => setChokepointDraft(prev => ({ ...prev, watch_radius_km: event.target.value }))}
                  placeholder="25"
                />
              </FormGroup>
            </div>
            <FormGroup label="Notes" labelFor="chokepoint-notes">
              <TextArea
                id="chokepoint-notes"
                fill
                rows={4}
                value={chokepointDraft.notes}
                onChange={event => setChokepointDraft(prev => ({ ...prev, notes: event.target.value }))}
                placeholder="Traffic restrictions, boarding pattern, ISR emphasis, or escalation thresholds."
              />
            </FormGroup>
            {error && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{error}</Callout>}
            {notice && <Callout intent="success" compact style={{ marginBottom: 12 }}>{notice}</Callout>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="bp6-text-muted" style={{ fontSize: 12 }}>
                {selectedDoctrineAo ? `${selectedDoctrineAo.name} · ${doctrineChokepoints.length} chokepoint${doctrineChokepoints.length === 1 ? '' : 's'}` : 'Select an area of operation'}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                {selectedChokepoint && (
                  <Button intent="danger" outlined loading={deleting} onClick={onDelete}>
                    Delete
                  </Button>
                )}
                <Button intent="primary" disabled={isReplaying} loading={saving} onClick={onSave}>
                  {selectedChokepoint ? 'Update chokepoint' : 'Create chokepoint'}
                </Button>
              </div>
            </div>
          </Card>

          <Card style={{ background: 'rgba(255,255,255,0.02)' }}>
            <HTMLTable compact bordered style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Radius</th>
                  <th>Location</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {doctrineChokepoints.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="bp6-text-muted" style={{ fontSize: 12 }}>
                      No chokepoints recorded for this area of operation yet.
                    </td>
                  </tr>
                ) : (
                  doctrineChokepoints.map(point => (
                    <tr key={point.id}>
                      <td style={{ fontSize: 12 }}>{point.name}</td>
                      <td style={{ fontSize: 12 }}>{humanize(point.category)}</td>
                      <td style={{ fontSize: 12 }}>
                        <Tag
                          minimal
                          intent={
                            point.status === 'closed' ? 'danger' :
                              point.status === 'contested' ? 'warning' :
                                point.status === 'constrained' ? 'primary' :
                                  'none'
                          }
                        >
                          {humanize(point.status)}
                        </Tag>
                      </td>
                      <td style={{ fontSize: 12 }}>{point.watch_radius_km.toFixed(1)} km</td>
                      <td style={{ fontSize: 12 }}>{point.latitude.toFixed(3)}, {point.longitude.toFixed(3)}</td>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(point.updated_at).toLocaleString()}</td>
                      <td style={{ fontSize: 12 }}>
                        <Button
                          small
                          minimal
                          icon="edit"
                          onClick={() => {
                            setPendingSelectedChokepoint(null)
                            setSelectedChokepointId(point.id)
                          }}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </HTMLTable>
          </Card>
        </div>
      )}
    </section>
  )
}
