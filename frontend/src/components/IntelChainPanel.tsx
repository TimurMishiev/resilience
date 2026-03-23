import { useMemo, useCallback, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Tag, Spinner, NonIdealState } from '@blueprintjs/core'
import { useIncidentChain } from '../hooks/useIncidents'
import type { ChainNodeType, ChainNodeData } from '../api/incidents'
import { humanize } from '../utils/humanize'

// ---------------------------------------------------------------------------
// Node visual config
// ---------------------------------------------------------------------------
const NODE_CONFIG: Record<ChainNodeType, { border: string; bg: string; label: string }> = {
  signal:   { border: '#00d4ff', bg: '#071a2b', label: 'SIGNAL'   },
  rule:     { border: '#a855f7', bg: '#140a22', label: 'RULE'     },
  alert:    { border: '#f97316', bg: '#1f1108', label: 'ALERT'    },
  incident: { border: '#ef4444', bg: '#1f0a0a', label: 'INCIDENT' },
  task:     { border: '#22c55e', bg: '#0a1f0e', label: 'TASK'     },
}

const STATUS_INTENT: Record<string, string> = {
  open: '#ef4444', acknowledged: '#f97316', contained: '#3b82f6',
  resolved: '#22c55e', closed: '#6b7280',
  unacknowledged: '#ef4444', investigating: '#3b82f6',
  new: '#6b7280', triaged: '#f59e0b', in_progress: '#3b82f6', blocked: '#ef4444',
}

// ---------------------------------------------------------------------------
// Custom node component (handles all types)
// ---------------------------------------------------------------------------
function ChainNode({ data, type, selected }: NodeProps) {
  const nodeType = (type ?? 'signal') as ChainNodeType
  const cfg  = NODE_CONFIG[nodeType] ?? NODE_CONFIG.signal
  const d    = data as unknown as ChainNodeData

  return (
    <div
      className={`intel-node intel-node--${nodeType}${selected ? ' intel-node--selected' : ''}`}
      style={{
        border:     `2px solid ${cfg.border}`,
        background: cfg.bg,
        minWidth:   170,
        borderRadius: 6,
        padding:    '8px 12px',
        cursor:     'default',
        boxShadow:  selected ? `0 0 10px ${cfg.border}66` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left}  style={{ background: cfg.border }} />

      <div style={{ fontSize: 9, letterSpacing: 1, color: cfg.border, fontWeight: 700, marginBottom: 2 }}>
        {cfg.label}
      </div>
      <div style={{ fontWeight: 600, fontSize: 13, color: '#e5e7eb', marginBottom: 4, lineHeight: 1.3 }}>
        {d.label}
      </div>

      {d.status && (
        <div style={{ fontSize: 11, color: STATUS_INTENT[d.status] ?? '#9ca3af' }}>
          {humanize(d.status)}
        </div>
      )}
      {d.severity && (
        <div style={{ fontSize: 11, color: STATUS_INTENT[d.severity] ?? '#9ca3af' }}>
          {d.severity}
        </div>
      )}
      {d.confidence !== undefined && (
        <div style={{ fontSize: 11, color: '#9ca3af' }}>
          {Math.round(d.confidence * 100)}% confidence
        </div>
      )}
      {d.source && (
        <div style={{ fontSize: 11, color: '#9ca3af' }}>{d.source}</div>
      )}
      {d.priority && (
        <div style={{ fontSize: 11, color: '#9ca3af' }}>{d.priority} priority</div>
      )}

      <Handle type="source" position={Position.Right} style={{ background: cfg.border }} />
    </div>
  )
}

const nodeTypes = {
  signal:   ChainNode,
  rule:     ChainNode,
  alert:    ChainNode,
  incident: ChainNode,
  task:     ChainNode,
}

// ---------------------------------------------------------------------------
// Layout: assign x/y positions by layer
// ---------------------------------------------------------------------------
const LAYER_X: Record<ChainNodeType, number> = {
  signal:   30,
  rule:     280,
  alert:    530,
  incident: 780,
  task:     780,
}

function layoutNodes(
  rawNodes: { id: string; type: ChainNodeType; data: ChainNodeData }[]
): Node[] {
  // Group by type to calculate y offsets within each layer
  const byType: Record<string, string[]> = {}
  for (const n of rawNodes) {
    if (!byType[n.type]) byType[n.type] = []
    byType[n.type].push(n.id)
  }

  const positions: Record<string, { x: number; y: number }> = {}

  // Lay out each type independently, centering vertically around y=200
  for (const [t, ids] of Object.entries(byType)) {
    const x    = LAYER_X[t as ChainNodeType] ?? 30
    const span = (ids.length - 1) * 120
    ids.forEach((id, i) => {
      positions[id] = { x, y: 200 - span / 2 + i * 120 }
    })
  }

  // Tasks share x with incident — offset below incident nodes
  if (byType.task && byType.incident) {
    const incidentBottom = positions[byType.incident[byType.incident.length - 1]]?.y ?? 200
    byType.task.forEach((id, i) => {
      positions[id] = { x: LAYER_X.task + 220, y: incidentBottom + 140 + i * 120 }
    })
  }

  return rawNodes.map(n => ({
    id:       n.id,
    type:     n.type,
    position: positions[n.id] ?? { x: 0, y: 0 },
    data:     n.data as unknown as Record<string, unknown>,
  }))
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
interface IntelChainPanelProps {
  incidentId: string
}

export default function IntelChainPanel({ incidentId }: IntelChainPanelProps) {
  const { data, isLoading, error } = useIncidentChain(incidentId)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const rfNodes: Node[] = useMemo(() => {
    if (!data) return []
    return layoutNodes(data.nodes as { id: string; type: ChainNodeType; data: ChainNodeData }[])
  }, [data])

  const rfEdges: Edge[] = useMemo(() => {
    if (!data) return []
    return data.edges.map(e => ({
      id:             e.id,
      source:         e.source,
      target:         e.target,
      label:          e.label,
      type:           'smoothstep',
      animated:       false,
      style:          { stroke: '#4b5563', strokeWidth: 1.5 },
      labelStyle:     { fill: '#9ca3af', fontSize: 10 },
      labelBgStyle:   { fill: '#111827', fillOpacity: 0.85 },
      labelBgPadding: [4, 2] as [number, number],
    }))
  }, [data])

  const selectedNode = useMemo(
    () => data?.nodes.find(n => n.id === selectedId) ?? null,
    [data, selectedId]
  )

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedId(prev => prev === node.id ? null : node.id)
  }, [])

  if (isLoading) return <div style={{ padding: 32, textAlign: 'center' }}><Spinner /></div>
  if (error) return (
    <div style={{ padding: 24 }}>
      <NonIdealState icon="error" title="Failed to load chain" description={error.message} />
    </div>
  )
  if (!data || data.nodes.length === 0) return (
    <div style={{ paddingTop: 48 }}>
      <NonIdealState
        icon="diagram-tree"
        title="No chain data"
        description="Alerts are linked to this incident automatically by the fusion engine."
      />
    </div>
  )

  return (
    <div style={{ display: 'flex', height: 520, gap: 0 }}>
      {/* DAG canvas */}
      <div style={{ flex: 1, position: 'relative', background: '#0a0f1a', borderRadius: 6 }}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#1f2937" variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls showInteractive={false} style={{ background: '#1f2937', border: '1px solid #374151' }} />
        </ReactFlow>

        {/* Legend */}
        <div style={{
          position: 'absolute', top: 12, right: 12,
          background: '#111827cc', border: '1px solid #374151',
          borderRadius: 6, padding: '8px 12px', fontSize: 11,
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          {(Object.entries(NODE_CONFIG) as [ChainNodeType, typeof NODE_CONFIG[ChainNodeType]][]).map(([t, c]) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#d1d5db' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: c.border, flexShrink: 0 }} />
              {c.label}
            </div>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      {selectedNode && (
        <div style={{
          width: 220, flexShrink: 0, padding: 16,
          borderLeft: `3px solid ${NODE_CONFIG[selectedNode.type as ChainNodeType]?.border ?? '#4b5563'}`,
          background: '#111827', overflowY: 'auto', borderRadius: '0 6px 6px 0',
        }}>
          <div style={{ fontSize: 9, letterSpacing: 1, fontWeight: 700, marginBottom: 6,
            color: NODE_CONFIG[selectedNode.type as ChainNodeType]?.border ?? '#9ca3af' }}>
            {selectedNode.type.toUpperCase()}
          </div>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#f3f4f6', marginBottom: 12 }}>
            {selectedNode.data.label}
          </div>

          {[
            ['Status',     selectedNode.data.status],
            ['Severity',   selectedNode.data.severity],
            ['Priority',   selectedNode.data.priority],
            ['Confidence', selectedNode.data.confidence !== undefined
              ? `${Math.round((selectedNode.data.confidence as number) * 100)}%` : null],
            ['Source',     selectedNode.data.source],
            ['Occurred',   selectedNode.data.occurred_at
              ? new Date(selectedNode.data.occurred_at as string).toLocaleString() : null],
            ['Fired',      selectedNode.data.fired_at
              ? new Date(selectedNode.data.fired_at as string).toLocaleString() : null],
            ['Coordinates', selectedNode.data.lat
              ? `${Number(selectedNode.data.lat).toFixed(4)}, ${Number(selectedNode.data.lng).toFixed(4)}`
              : null],
          ].filter(([, v]) => v != null).map(([k, v]) => (
            <div key={String(k)} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: 12, color: '#d1d5db' }}>{String(v)}</div>
            </div>
          ))}

          <Tag
            minimal
            style={{
              marginTop: 8, fontSize: 10,
              background: `${NODE_CONFIG[selectedNode.type as ChainNodeType]?.border ?? '#4b5563'}18`,
              color: NODE_CONFIG[selectedNode.type as ChainNodeType]?.border ?? '#9ca3af',
            }}
          >
            {selectedNode.id}
          </Tag>
        </div>
      )}
    </div>
  )
}
