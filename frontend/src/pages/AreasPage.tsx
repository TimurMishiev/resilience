import { useState } from 'react'
import {
  Button,
  Callout,
  Classes,
  Drawer,
  DrawerSize,
  FormGroup,
  HTMLSelect,
  HTMLTable,
  InputGroup,
  NonIdealState,
  Tag,
  TextArea,
} from '@blueprintjs/core'
import {
  useAreasOfOperation,
  useCreateAreaOfOperation,
  useUpdateAreaOfOperation,
  useDeleteAreaOfOperation,
} from '../hooks/useAreasOfOperation'
import { useSites } from '../hooks/useSites'
import { useCorrelationRules } from '../hooks/useCorrelationRules'
import { useRole } from '../hooks/useRole'
import { useReplay } from '../context/ReplayContext'
import { PostureSelector } from '../components/PostureSelector'
import { PostureBadge } from '../components/PostureBadge'
import type { AreaOfOperation, ThreatLevel } from '../api/types'
import type { Intent } from '@blueprintjs/core'

const SKELETON_ROWS = 5

const THREAT_LEVELS: { value: ThreatLevel; label: string }[] = [
  { value: 'green', label: 'Green — Routine' },
  { value: 'amber', label: 'Amber — Elevated' },
  { value: 'red',   label: 'Red — High' },
  { value: 'black', label: 'Black — Severe' },
]

const THREAT_COLORS: Record<ThreatLevel, string> = {
  green: '#23d160',
  amber: '#ffb347',
  red:   '#ff4757',
  black: '#606060',
}

const THREAT_INTENTS: Record<ThreatLevel, Intent> = {
  green: 'success',
  amber: 'warning',
  red:   'danger',
  black: 'none',
}

// ── Form state ────────────────────────────────────────────────────────────────
interface AreaFormState {
  name:         string
  description:  string
  threat_level: ThreatLevel
  color:        string
  geometryText: string  // raw JSON string the user pastes
}

const BLANK_FORM: AreaFormState = {
  name:         '',
  description:  '',
  threat_level: 'green',
  color:        THREAT_COLORS['green'],
  geometryText: '',
}

function formFromArea(area: AreaOfOperation): AreaFormState {
  return {
    name:         area.name,
    description:  area.description ?? '',
    threat_level: area.threat_level,
    color:        area.color,
    geometryText: JSON.stringify(area.geometry, null, 2),
  }
}

// ── AreasPage ─────────────────────────────────────────────────────────────────
export default function AreasPage() {
  const role = useRole()
  const canManageAreas = role.canManageAreas ?? role.isCommander
  const { isReplaying, asOf } = useReplay()
  const replayParams = asOf ? { as_of: asOf } : undefined

  const areasQuery = useAreasOfOperation({ per_page: 200, ...(replayParams ?? {}) })
  const sitesQuery = useSites({ per_page: 200, ...(replayParams ?? {}) })
  const rulesQuery = useCorrelationRules(replayParams)

  const createArea = useCreateAreaOfOperation()
  const updateArea = useUpdateAreaOfOperation()
  const deleteArea = useDeleteAreaOfOperation()

  const areas = areasQuery.data?.data ?? []
  const sites = sitesQuery.data?.data ?? []
  const rules = rulesQuery.data?.data ?? []

  const loading = areasQuery.isLoading || sitesQuery.isLoading || rulesQuery.isLoading
  const error   = areasQuery.error?.message ?? sitesQuery.error?.message ?? rulesQuery.error?.message ?? null

  // Count sites and rules per AO
  const sitesPerAo: Record<string, number> = {}
  const rulesPerAo: Record<string, number> = {}
  for (const s of sites) {
    if (s.area_of_operation_id) {
      sitesPerAo[s.area_of_operation_id] = (sitesPerAo[s.area_of_operation_id] ?? 0) + 1
    }
  }
  for (const r of rules) {
    if (r.area_of_operation_id) {
      rulesPerAo[r.area_of_operation_id] = (rulesPerAo[r.area_of_operation_id] ?? 0) + 1
    }
  }

  // ── Drawer state ────────────────────────────────────────────────────────────
  const [drawerOpen,   setDrawerOpen]   = useState(false)
  const [editingArea,  setEditingArea]  = useState<AreaOfOperation | null>(null)
  const [form,         setForm]         = useState<AreaFormState>(BLANK_FORM)
  const [formError,    setFormError]    = useState<string | null>(null)

  function openCreate() {
    setEditingArea(null)
    setForm(BLANK_FORM)
    setFormError(null)
    setDrawerOpen(true)
  }

  function openEdit(area: AreaOfOperation) {
    setEditingArea(area)
    setForm(formFromArea(area))
    setFormError(null)
    setDrawerOpen(true)
  }

  function closeDrawer() {
    setDrawerOpen(false)
    setEditingArea(null)
    setFormError(null)
  }

  function handleThreatChange(level: ThreatLevel) {
    setForm(f => ({ ...f, threat_level: level, color: THREAT_COLORS[level] }))
  }

  function handleSave() {
    setFormError(null)
    if (!form.name.trim()) { setFormError('Name is required.'); return }
    if (!form.geometryText.trim()) { setFormError('Geometry is required.'); return }

    let geometry: unknown
    try {
      geometry = JSON.parse(form.geometryText)
    } catch {
      setFormError('Geometry must be valid JSON.')
      return
    }
    if ((geometry as { type?: string }).type !== 'Polygon') {
      setFormError('Geometry must be a GeoJSON Polygon object (type: "Polygon").')
      return
    }

    const body = {
      name:         form.name.trim(),
      description:  form.description.trim() || undefined,
      threat_level: form.threat_level,
      color:        form.color,
      geometry:     geometry as { type: 'Polygon'; coordinates: number[][][] },
    }

    if (editingArea) {
      updateArea.mutate(
        { id: editingArea.id, body },
        { onSuccess: closeDrawer, onError: (e) => setFormError(e.message) },
      )
    } else {
      createArea.mutate(body, {
        onSuccess: closeDrawer,
        onError: (e) => setFormError(e.message),
      })
    }
  }

  function handleDelete(area: AreaOfOperation) {
    if (!window.confirm(`Delete "${area.name}"? This cannot be undone.`)) return
    deleteArea.mutate(area.id)
  }

  const isPending = createArea.isPending || updateArea.isPending

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <h2 className="bp6-heading">Areas of Operation</h2>
        {canManageAreas && !isReplaying && (
          <Button intent="primary" icon="add" onClick={openCreate}>
            New Area
          </Button>
        )}
      </div>

      {isReplaying && (
        <Callout intent="warning" icon="history" style={{ marginBottom: 16 }}>
          Viewing historical AO posture, site membership, and rule coverage at the replay timestamp. Configuration remains read-only during replay.
        </Callout>
      )}

      {error && (
        <Callout intent="danger" title="Failed to load areas" className="page-error-callout">
          {error}
        </Callout>
      )}

      {!error && areas.length === 0 && !loading && (
        <NonIdealState
          icon="polygon-filter"
          title="No areas defined"
          description={
            canManageAreas && !isReplaying
              ? 'Create a named geofenced area to scope sites and correlation rules.'
              : 'No areas of operation have been configured yet.'
          }
          action={
            canManageAreas && !isReplaying
              ? <Button intent="primary" icon="add" onClick={openCreate}>New Area</Button>
              : undefined
          }
        />
      )}

      {(loading || areas.length > 0) && (
        <HTMLTable striped bordered className="bp6-html-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Threat Level</th>
              <th>ROE Posture</th>
              <th>Color</th>
              <th>Sites</th>
              <th>Rules</th>
              {canManageAreas && !isReplaying && <th style={{ width: 80 }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: canManageAreas && !isReplaying ? 7 : 6 }).map((__, j) => (
                      <td key={j}><span className={Classes.SKELETON}>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></td>
                    ))}
                  </tr>
                ))
              : areas.map(area => (
                  <tr key={area.id}>
                    <td>
                      <strong>{area.name}</strong>
                      {area.description && (
                        <span className="bp6-text-muted" style={{ marginLeft: 8, fontSize: 12 }}>
                          {area.description}
                        </span>
                      )}
                    </td>
                    <td>
                      <Tag intent={THREAT_INTENTS[area.threat_level]} minimal>
                        {area.threat_level.toUpperCase()}
                      </Tag>
                    </td>
                    <td style={{ minWidth: 180 }}>
                      {canManageAreas && !isReplaying
                        ? <PostureSelector area={area} />
                        : <PostureBadge posture={area.posture} />
                      }
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{
                            display:      'inline-block',
                            width:        16,
                            height:       16,
                            borderRadius: 3,
                            background:   area.color,
                            border:       '1px solid rgba(255,255,255,0.2)',
                            flexShrink:   0,
                          }}
                        />
                        <code style={{ fontSize: 11 }}>{area.color}</code>
                      </div>
                    </td>
                    <td>{sitesPerAo[area.id] ?? 0}</td>
                    <td>{rulesPerAo[area.id] ?? 0}</td>
                    {canManageAreas && !isReplaying && (
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <Button
                            small minimal icon="edit"
                            title="Edit"
                            onClick={() => openEdit(area)}
                          />
                          <Button
                            small minimal icon="trash" intent="danger"
                            title="Delete"
                            loading={deleteArea.isPending}
                            onClick={() => handleDelete(area)}
                          />
                        </div>
                      </td>
                    )}
                  </tr>
                ))
            }
          </tbody>
        </HTMLTable>
      )}

      {/* ── Create / Edit Drawer ── */}
      <Drawer
        isOpen={drawerOpen}
        onClose={closeDrawer}
        title={editingArea ? `Edit: ${editingArea.name}` : 'New Area of Operation'}
        size={DrawerSize.SMALL}
        className="bp6-dark"
      >
        <div className="bp6-drawer-body" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {formError && (
            <Callout intent="danger" compact>{formError}</Callout>
          )}

          <FormGroup label="Name" labelInfo="(required)">
            <InputGroup
              value={form.name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setForm(f => ({ ...f, name: e.target.value }))
              }
              placeholder="e.g. European Command (EUCOM)"
            />
          </FormGroup>

          <FormGroup label="Description">
            <TextArea
              fill
              rows={2}
              value={form.description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setForm(f => ({ ...f, description: e.target.value }))
              }
              placeholder="Optional description"
            />
          </FormGroup>

          <FormGroup label="Threat Level">
            <HTMLSelect
              value={form.threat_level}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                handleThreatChange(e.target.value as ThreatLevel)
              }
              fill
            >
              {THREAT_LEVELS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </HTMLSelect>
          </FormGroup>

          <FormGroup label="Color" helperText="6-digit hex color, auto-set from threat level">
            <InputGroup
              value={form.color}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setForm(f => ({ ...f, color: e.target.value }))
              }
              placeholder="#23d160"
              leftElement={
                <span style={{
                  display:      'inline-block',
                  width:        16,
                  height:       16,
                  borderRadius: 2,
                  background:   /^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : '#888',
                  margin:       'auto 4px',
                  border:       '1px solid rgba(255,255,255,0.2)',
                }} />
              }
            />
          </FormGroup>

          <FormGroup
            label="Geometry"
            labelInfo="(required)"
            helperText='Paste a GeoJSON Polygon geometry object: { "type": "Polygon", "coordinates": [[[lng,lat],...]] }'
          >
            <TextArea
              fill
              rows={8}
              value={form.geometryText}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setForm(f => ({ ...f, geometryText: e.target.value }))
              }
              placeholder={'{\n  "type": "Polygon",\n  "coordinates": [[[5,38],[40,38],[40,55],[5,55],[5,38]]]\n}'}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </FormGroup>
        </div>

        <div className="bp6-drawer-footer" style={{ padding: '12px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button onClick={closeDrawer} disabled={isPending}>Cancel</Button>
          <Button intent="primary" loading={isPending} onClick={handleSave}>
            {editingArea ? 'Save Changes' : 'Create Area'}
          </Button>
        </div>
      </Drawer>
    </div>
  )
}
