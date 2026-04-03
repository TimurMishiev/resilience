import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Callout,
  Card,
  NonIdealState,
  Spinner,
  Tag,
  TextArea,
} from '@blueprintjs/core'
import { postAiOntologyQuery } from '../api/ai'
import { getApiErrorMessage } from '../api/client'
import { useReplay } from '../context/ReplayContext'
import type {
  AiOntologyEdge,
  AiOntologyNode,
  AiOntologyNodeType,
  AiOntologyQueryResult,
} from '../api/types'
import { humanize } from '../utils/humanize'

const NODE_SECTION_ORDER: AiOntologyNodeType[] = [
  'site',
  'area_of_operation',
  'incident',
  'task',
  'asset',
  'alert',
  'signal',
  'recommendation',
  'prosecution_step',
]

const SAMPLE_QUERIES = [
  'Show incidents, alerts, and recommendations connected to Forward Site Alpha.',
  'Map the prosecution state and linked alerts for Harbor breach watch.',
  'Show the task, incident, and recommendation context around Guardian 01.',
]

function groupNodes(nodes: AiOntologyNode[]) {
  return nodes.reduce<Record<string, AiOntologyNode[]>>((groups, node) => {
    groups[node.type] ||= []
    groups[node.type].push(node)
    return groups
  }, {})
}

function describeMetadata(node: AiOntologyNode) {
  return Object.entries(node.metadata)
    .filter(([, value]) => value !== null && value !== '')
    .map(([key, value]) => `${humanize(key)}: ${value}`)
}

function edgeLabel(edge: AiOntologyEdge, nodesById: Record<string, AiOntologyNode>) {
  const source = nodesById[edge.source]?.label ?? edge.source
  const target = nodesById[edge.target]?.label ?? edge.target
  return `${source} → ${target}`
}

export default function OntologyQueryPanel() {
  const { isReplaying, asOf } = useReplay()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AiOntologyQueryResult | null>(null)

  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const replayBanner = isReplaying && (
    <Callout intent="primary" icon="info-sign" style={{ marginBottom: 12 }}>
      Resolving the operational graph as it existed at the replay timestamp. Results are scoped to the selected historical cutoff.
    </Callout>
  )

  const nodesByType = result ? groupNodes(result.nodes) : {}
  const nodesById = result
    ? result.nodes.reduce<Record<string, AiOntologyNode>>((index, node) => {
        index[node.id] = node
        return index
      }, {})
    : {}

  function runQuery(nextQuery?: string) {
    const value = (nextQuery ?? query).trim()
    if (!value) return

    setLoading(true)
    setError(null)
    setResult(null)

    postAiOntologyQuery({ q: value, ...(isReplaying && asOf ? { as_of: asOf } : {}) })
      .then(({ data }) => {
        if (!mountedRef.current) return
        setResult(data)
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return
        setError(getApiErrorMessage(err, 'Ontology query failed'))
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })
  }

  return (
    <div className="ontology-panel">
      {replayBanner}
      <Card className="ontology-query-card">
        <div className="ontology-query-header">
          <div>
            <div className="ontology-eyebrow">NATURAL-LANGUAGE GRAPH QUERY</div>
            <p className="ontology-helper">
              Resolve one named entity, traverse its connected operational graph, and return a bounded cross-entity answer.
            </p>
          </div>
          <div className="ontology-hint-tags">
            <Tag minimal>Sites</Tag>
            <Tag minimal>Incidents</Tag>
            <Tag minimal>Tasks</Tag>
            <Tag minimal>Assets</Tag>
            <Tag minimal>Areas</Tag>
          </div>
        </div>

        <TextArea
          fill
          rows={4}
          value={query}
          onChange={e => setQuery(e.currentTarget.value)}
          placeholder="e.g. Show incidents, alerts, tasks, and recommendations connected to Forward Site Alpha."
          style={{ resize: 'vertical' }}
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              runQuery()
            }
          }}
        />

        <div className="ontology-query-actions">
          <Button
            intent="primary"
            icon="search"
            text="Run ontology query"
            loading={loading}
            disabled={!query.trim()}
            onClick={() => runQuery()}
          />
          <span className="bp6-text-muted ontology-query-shortcut">Ctrl+Enter to submit</span>
        </div>

        <div className="ontology-samples">
          {SAMPLE_QUERIES.map(sample => (
            <button
              key={sample}
              className="ontology-sample"
              type="button"
              onClick={() => {
                setQuery(sample)
                runQuery(sample)
              }}
            >
              {sample}
            </button>
          ))}
        </div>

        {loading && (
          <div className="ontology-loading">
            <Spinner size={20} />
            <span className="bp6-text-muted">Resolving operational graph…</span>
          </div>
        )}

        {error && (
          <Callout intent="danger" className="ontology-error">
            {error}
          </Callout>
        )}
      </Card>

      {!loading && !result && !error && (
        <NonIdealState
          icon="search"
          title="No ontology query yet"
          description="Ask for the graph around a site, incident, task, asset, or area of operation."
        />
      )}

      {result && (
        <div className="ontology-result-grid">
          <Card className="ontology-summary-card">
            <div className="ontology-eyebrow">QUERY SUMMARY</div>
            <p className="ontology-summary-text">{result.summary}</p>
            <div className="ontology-summary-tags">
              <Tag minimal intent="primary">{humanize(result.normalized_query.root_type)}</Tag>
              <Tag minimal>{result.normalized_query.root_label}</Tag>
              <Tag minimal>{result.counts.node_count} nodes</Tag>
              <Tag minimal>{result.counts.edge_count} edges</Tag>
              <Tag minimal>{result.normalized_query.time_window_hours}h window</Tag>
              {result.normalized_query.as_of && <Tag minimal intent="success">As of {new Date(result.normalized_query.as_of).toLocaleString()}</Tag>}
            </div>
            <div className="ontology-relation-tags">
              {result.normalized_query.relations.map(relation => (
                <Tag key={relation} minimal intent="warning">
                  {humanize(relation)}
                </Tag>
              ))}
            </div>
          </Card>

          <Card className="ontology-summary-card">
            <div className="ontology-eyebrow">RELATIONSHIPS</div>
            {result.edges.length === 0 ? (
              <div className="bp6-text-muted">No edges returned.</div>
            ) : (
              <div className="ontology-edge-list">
                {result.edges.map(edge => (
                  <div key={`${edge.source}-${edge.target}-${edge.relation}`} className="ontology-edge-row">
                    <span>{edgeLabel(edge, nodesById)}</span>
                    <Tag minimal>{humanize(edge.relation)}</Tag>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className="ontology-node-sections">
            {NODE_SECTION_ORDER.filter(type => nodesByType[type]?.length).map(type => (
              <Card key={type} className="ontology-node-card">
                <div className="ontology-node-card-header">
                  <span className="ontology-eyebrow">{humanize(type)}</span>
                  <Tag minimal>{nodesByType[type].length}</Tag>
                </div>

                <div className="ontology-node-list">
                  {nodesByType[type].map(node => {
                    const metadataEntries = describeMetadata(node)

                    return (
                      <div key={node.id} className={`ontology-node-row ${node.root ? 'ontology-node-row--root' : ''}`}>
                        <div className="ontology-node-row-top">
                          <span className="ontology-node-label">{node.label}</span>
                          {node.root && <Tag minimal intent="success">Root</Tag>}
                        </div>
                        <div className="ontology-node-sublabel">{node.sublabel}</div>
                        {metadataEntries.length > 0 && (
                          <div className="ontology-node-meta">
                            {metadataEntries.map(entry => (
                              <Tag key={entry} minimal>{entry}</Tag>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
