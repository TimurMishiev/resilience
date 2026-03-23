import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import * as d3 from 'd3'
import { Button, Callout, Divider, Spinner, Tag } from '@blueprintjs/core'
import { useSites } from '../hooks/useSites'
import { useTasks } from '../hooks/useTasks'
import { useAssets } from '../hooks/useAssets'
import { useReplay } from '../context/ReplayContext'
import type { Site, Task, Asset, WorkflowStatus } from '../api/types'
import type { Intent } from '@blueprintjs/core'
import { humanize } from '../utils/humanize'

// ---------------------------------------------------------------------------
// Graph data types
// ---------------------------------------------------------------------------
type NodeType = 'site' | 'task' | 'asset'

interface GraphNode extends d3.SimulationNodeDatum {
  id:       string
  type:     NodeType
  label:    string
  sublabel: string
  data:     Site | Task | Asset
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode
  target: string | GraphNode
  kind:   'site-task' | 'task-asset' | 'asset-site'
}

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------
const NODE_RADIUS: Record<NodeType, number> = { site: 20, task: 13, asset: 16 }
const NODE_COLOR:  Record<NodeType, string> = {
  site:  '#4c90f0',
  task:  '#8abbff',
  asset: '#72ca9b',
}

function taskColor(status: WorkflowStatus): string {
  switch (status) {
    case 'blocked':     return '#ff7373'
    case 'resolved':    return '#3ddc84'
    case 'in_progress': return '#4c90f0'
    case 'triaged':     return '#ffb366'
    default:            return '#8abbff'
  }
}

function workflowIntent(status: WorkflowStatus): Intent {
  switch (status) {
    case 'blocked':     return 'danger'
    case 'resolved':    return 'success'
    case 'in_progress': return 'primary'
    case 'triaged':     return 'warning'
    default:            return 'none'
  }
}

// ---------------------------------------------------------------------------
// Build graph data from entity arrays
// ---------------------------------------------------------------------------
function buildGraph(
  sites:   Site[],
  tasks:   Task[],
  assets:  Asset[],
  filters: Set<NodeType>,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = []
  const links: GraphLink[] = []

  if (filters.has('site')) {
    for (const s of sites) {
      nodes.push({
        id:       `site-${s.id}`,
        type:     'site',
        label:    s.name,
        sublabel: s.status,
        data:     s,
      })
    }
  }

  if (filters.has('asset')) {
    for (const a of assets) {
      nodes.push({
        id:       `asset-${a.id}`,
        type:     'asset',
        label:    a.name,
        sublabel: `${a.asset_type} · ${humanize(a.status)}`,
        data:     a,
      })
      // asset → home site edge
      if (filters.has('site') && a.home_site_id) {
        links.push({
          source: `asset-${a.id}`,
          target: `site-${a.home_site_id}`,
          kind:   'asset-site',
        })
      }
    }
  }

  if (filters.has('task')) {
    for (const t of tasks) {
      nodes.push({
        id:       `task-${t.id}`,
        type:     'task',
        label:    t.title,
        sublabel: humanize(t.workflow_status),
        data:     t,
      })
      // site → task edge
      if (filters.has('site')) {
        links.push({
          source: `site-${t.site_id}`,
          target: `task-${t.id}`,
          kind:   'site-task',
        })
      }
      // task → asset edge
      if (filters.has('asset') && t.asset_id) {
        links.push({
          source: `task-${t.id}`,
          target: `asset-${t.asset_id}`,
          kind:   'task-asset',
        })
      }
    }
  }

  return { nodes, links }
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------
interface PanelProps {
  node: GraphNode | null
  onClose: () => void
}

function DetailPanel({ node, onClose }: PanelProps) {
  if (!node) return null

  const isSite  = node.type === 'site'
  const isTask  = node.type === 'task'
  const isAsset = node.type === 'asset'

  const site  = isSite  ? (node.data as Site)  : null
  const task  = isTask  ? (node.data as Task)  : null
  const asset = isAsset ? (node.data as Asset) : null

  return (
    <div className="graph-panel bp6-dark">
      <div className="graph-panel-header">
        <div className="graph-panel-title-row">
          <Tag
            minimal
            intent={
              node.type === 'site'  ? 'primary'
              : node.type === 'asset' ? 'success'
              : task ? workflowIntent(task.workflow_status) : 'none'
            }
          >
            {node.type}
          </Tag>
          <button
            className="graph-panel-close bp6-button bp6-minimal bp6-icon-cross"
            onClick={onClose}
            aria-label="Close"
          />
        </div>
        <h4 className="graph-panel-name">{node.label}</h4>
        <p className="graph-panel-sub bp6-text-muted">{node.sublabel}</p>
      </div>

      <Divider />

      {site && (
        <div className="graph-panel-fields">
          <div className="graph-panel-field">
            <span className="graph-panel-field-label">Status</span>
            <Tag minimal intent={site.status === 'active' ? 'success' : 'none'}>{site.status}</Tag>
          </div>
          <div className="graph-panel-field">
            <span className="graph-panel-field-label">Coordinates</span>
            <span className="graph-panel-field-value">
              {Number(site.latitude).toFixed(4)}, {Number(site.longitude).toFixed(4)}
            </span>
          </div>
        </div>
      )}

      {task && (
        <div className="graph-panel-fields">
          <div className="graph-panel-field">
            <span className="graph-panel-field-label">Status</span>
            <Tag minimal intent={workflowIntent(task.workflow_status)}>
              {humanize(task.workflow_status)}
            </Tag>
          </div>
          <div className="graph-panel-field">
            <span className="graph-panel-field-label">Priority</span>
            <Tag minimal intent={
              task.priority === 'critical' ? 'danger'
              : task.priority === 'high' ? 'warning' : 'none'
            }>
              {task.priority}
            </Tag>
          </div>
          {task.description && (
            <div className="graph-panel-field graph-panel-field--full">
              <span className="graph-panel-field-label">Description</span>
              <span className="graph-panel-field-value">{task.description}</span>
            </div>
          )}
          {task.blocked_reason && (
            <div className="graph-panel-field graph-panel-field--full">
              <span className="graph-panel-field-label">Blocked reason</span>
              <span className="graph-panel-field-value bp6-intent-danger">{task.blocked_reason}</span>
            </div>
          )}
        </div>
      )}

      {asset && (
        <div className="graph-panel-fields">
          <div className="graph-panel-field">
            <span className="graph-panel-field-label">Type</span>
            <Tag minimal>{asset.asset_type}</Tag>
          </div>
          <div className="graph-panel-field">
            <span className="graph-panel-field-label">Status</span>
            <Tag minimal intent={
              asset.status === 'available' ? 'success'
              : asset.status === 'assigned' ? 'primary'
              : asset.status === 'degraded' ? 'warning'
              : 'danger'
            }>
              {humanize(asset.status)}
            </Tag>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// GraphPage
// ---------------------------------------------------------------------------
export default function GraphPage() {
  const { asOf } = useReplay()
  const asOfParam = asOf ? { as_of: asOf } : {}

  const sitesQuery  = useSites({ per_page: 200, ...asOfParam })
  const tasksQuery  = useTasks({ per_page: 200, ...asOfParam })
  const assetsQuery = useAssets({ per_page: 200, ...asOfParam })

  const sites  = useMemo(() => sitesQuery.data?.data  ?? [], [sitesQuery.data?.data])
  const tasks  = useMemo(() => tasksQuery.data?.data  ?? [], [tasksQuery.data?.data])
  const assets = useMemo(() => assetsQuery.data?.data ?? [], [assetsQuery.data?.data])

  const loading = sitesQuery.isLoading || tasksQuery.isLoading || assetsQuery.isLoading
  const error   = sitesQuery.error?.message ?? tasksQuery.error?.message ?? assetsQuery.error?.message ?? null

  const svgRef       = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const simRef       = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null)

  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [filters, setFilters]   = useState<Set<NodeType>>(new Set(['site', 'task', 'asset']))
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  function toggleFilter(type: NodeType) {
    setFilters(prev => {
      const next = new Set(prev)
      if (next.has(type)) {
        if (next.size === 1) return prev   // keep at least one
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  const buildAndRender = useCallback(() => {
    const svg = svgRef.current
    const container = containerRef.current
    if (!svg || !container) return

    const width  = container.clientWidth
    const height = container.clientHeight

    // Clear previous render
    d3.select(svg).selectAll('*').remove()
    if (simRef.current) { simRef.current.stop(); simRef.current = null }

    const { nodes, links } = buildGraph(sites, tasks, assets, filters)
    if (nodes.length === 0) return

    d3.select(svg).attr('width', width).attr('height', height)

    const root = d3.select(svg).append('g').attr('class', 'graph-root')

    // Zoom + pan
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => root.attr('transform', event.transform))
    d3.select(svg).call(zoom)

    // Arrow markers for links
    const defs = d3.select(svg).append('defs')
    for (const kind of ['site-task', 'task-asset', 'asset-site']) {
      defs.append('marker')
        .attr('id', `arrow-${kind}`)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', 22)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', 'rgba(255,255,255,0.2)')
    }

    // Force simulation
    const sim = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links)
        .id(d => d.id)
        .distance(d => {
          const s = d.source as GraphNode
          const t = d.target as GraphNode
          if (s.type === 'site' || t.type === 'site') return 120
          return 80
        })
        .strength(0.6)
      )
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<GraphNode>(d => NODE_RADIUS[d.type] + 8))

    simRef.current = sim

    // Links
    const link = root.append('g').attr('class', 'graph-links')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('class', d => `graph-link graph-link--${d.kind}`)
      .attr('marker-end', d => `url(#arrow-${d.kind})`)

    // Node groups
    const node = root.append('g').attr('class', 'graph-nodes')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(nodes, d => d.id)
      .join('g')
      .attr('class', d => `graph-node graph-node--${d.type}`)
      .style('cursor', 'pointer')
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) sim.alphaTarget(0.3).restart()
            d.fx = d.x; d.fy = d.y
          })
          .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
          .on('end', (event, d) => {
            if (!event.active) sim.alphaTarget(0)
            d.fx = null; d.fy = null
          })
      )

    // Circle
    node.append('circle')
      .attr('r', d => NODE_RADIUS[d.type])
      .attr('fill', d => {
        if (d.type === 'task') return taskColor((d.data as Task).workflow_status)
        return NODE_COLOR[d.type]
      })
      .attr('stroke', 'rgba(255,255,255,0.15)')
      .attr('stroke-width', 1.5)

    // Label
    node.append('text')
      .attr('dy', d => NODE_RADIUS[d.type] + 12)
      .attr('text-anchor', 'middle')
      .attr('class', 'graph-node-label')
      .text(d => d.label.length > 22 ? d.label.slice(0, 20) + '…' : d.label)

    // Sublabel
    node.append('text')
      .attr('dy', d => NODE_RADIUS[d.type] + 24)
      .attr('text-anchor', 'middle')
      .attr('class', 'graph-node-sublabel')
      .text(d => d.sublabel)

    // Hover interactions
    node
      .on('mouseenter', (_event, d) => {
        setHoveredId(d.id)
        // Connected node IDs
        const connectedIds = new Set<string>([d.id])
        links.forEach(l => {
          const s = (l.source as GraphNode).id
          const t = (l.target as GraphNode).id
          if (s === d.id) connectedIds.add(t)
          if (t === d.id) connectedIds.add(s)
        })
        node.style('opacity', n => connectedIds.has(n.id) ? 1 : 0.15)
        link.style('opacity', l => {
          const s = (l.source as GraphNode).id
          const t = (l.target as GraphNode).id
          return s === d.id || t === d.id ? 1 : 0.05
        })
      })
      .on('mouseleave', () => {
        setHoveredId(null)
        node.style('opacity', 1)
        link.style('opacity', 1)
      })
      .on('click', (_event, d) => {
        setSelected(prev => prev?.id === d.id ? null : d)
      })

    // Tick
    sim.on('tick', () => {
      link
        .attr('x1', d => (d.source as GraphNode).x ?? 0)
        .attr('y1', d => (d.source as GraphNode).y ?? 0)
        .attr('x2', d => (d.target as GraphNode).x ?? 0)
        .attr('y2', d => (d.target as GraphNode).y ?? 0)

      node.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })
  }, [sites, tasks, assets, filters])

  useEffect(() => {
    if (!loading) buildAndRender()
    return () => { simRef.current?.stop() }
  }, [loading, buildAndRender])

  // Derive active selection — null if the node's type has been filtered out
  const activeSelected = selected && filters.has(selected.type) ? selected : null

  // ── Legend counts
  const counts = { site: sites.length, task: tasks.length, asset: assets.length }

  return (
    <div className="graph-page">
      {/* ── Toolbar ── */}
      <div className="graph-toolbar bp6-dark">
        <span className="graph-toolbar-title">Object Graph</span>
        <div className="graph-toolbar-filters">
          {(['site', 'task', 'asset'] as NodeType[]).map(type => (
            <Button
              key={type}
              small
              minimal={!filters.has(type)}
              active={filters.has(type)}
              className={`graph-filter-btn graph-filter-btn--${type}`}
              onClick={() => toggleFilter(type)}
            >
              <span
                className="graph-filter-dot"
                style={{ background: NODE_COLOR[type] }}
              />
              {type === 'site' ? 'Sites' : type === 'task' ? 'Tasks' : 'Assets'}
              <span className="graph-filter-count">{counts[type]}</span>
            </Button>
          ))}
        </div>
        <span className="graph-toolbar-hint bp6-text-muted">
          Scroll to zoom · drag to pan · drag nodes to reposition
        </span>
      </div>

      {/* ── Canvas ── */}
      <div ref={containerRef} className="graph-canvas">
        {loading && (
          <div className="graph-loading"><Spinner /></div>
        )}
        {error && (
          <div className="graph-error">
            <Callout intent="danger" title="Failed to load graph data" compact>{error}</Callout>
          </div>
        )}
        <svg ref={svgRef} className="graph-svg" />
      </div>

      {/* ── Detail panel ── */}
      <DetailPanel node={activeSelected} onClose={() => setSelected(null)} />

      {/* ── Legend ── */}
      {!loading && !hoveredId && (
        <div className="graph-legend bp6-dark">
          <div className="graph-legend-item">
            <span className="graph-legend-dot" style={{ background: NODE_COLOR.site }} />
            Site
          </div>
          <div className="graph-legend-item">
            <span className="graph-legend-dot" style={{ background: '#ff7373' }} />
            Blocked task
          </div>
          <div className="graph-legend-item">
            <span className="graph-legend-dot" style={{ background: '#3ddc84' }} />
            Resolved task
          </div>
          <div className="graph-legend-item">
            <span className="graph-legend-dot" style={{ background: NODE_COLOR.asset }} />
            Asset
          </div>
        </div>
      )}
    </div>
  )
}
