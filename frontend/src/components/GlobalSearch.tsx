import { useEffect, useRef, useState, useMemo } from 'react'
import { Icon, Tag } from '@blueprintjs/core'
import { useNavigate } from 'react-router-dom'
import { useSites } from '../hooks/useSites'
import { useTasks } from '../hooks/useTasks'
import { useAssets } from '../hooks/useAssets'
import type { Site, Task, Asset } from '../api/types'
import type { Intent } from '@blueprintjs/core'

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------
type EntityType = 'site' | 'task' | 'asset'

interface SearchResult {
  id: string
  type: EntityType
  title: string
  subtitle: string
  intent?: Intent
  tag?: string
  tagIntent?: Intent
  href: string
}

// ---------------------------------------------------------------------------
// Scoring — simple relevance: title match scores higher than subtitle
// ---------------------------------------------------------------------------
function score(result: SearchResult, q: string): number {
  const lq    = q.toLowerCase()
  const title = result.title.toLowerCase()
  const sub   = result.subtitle.toLowerCase()
  if (title === lq)            return 3
  if (title.startsWith(lq))   return 2
  if (title.includes(lq))     return 1
  if (sub.includes(lq))       return 0.5
  return -1
}

function workflowIntent(s: Task['workflow_status']): Intent {
  switch (s) {
    case 'blocked':     return 'danger'
    case 'resolved':    return 'success'
    case 'in_progress': return 'primary'
    case 'triaged':     return 'warning'
    default:            return 'none'
  }
}

// ---------------------------------------------------------------------------
// Build result list from raw data
// ---------------------------------------------------------------------------
function buildResults(
  sites:  Site[],
  tasks:  Task[],
  assets: Asset[],
  query:  string,
): SearchResult[] {
  if (!query.trim()) return []

  const siteMap: Record<string, string> = {}
  for (const s of sites) siteMap[s.id] = s.name

  const candidates: SearchResult[] = [
    ...sites.map(s => ({
      id:        s.id,
      type:      'site' as EntityType,
      title:     s.name,
      subtitle:  `Site · ${s.status}`,
      tag:       s.status,
      tagIntent: (s.status === 'active' ? 'success' : 'none') as Intent,
      href:      `/sites`,
    })),
    ...tasks.map(t => ({
      id:        t.id,
      type:      'task' as EntityType,
      title:     t.title,
      subtitle:  `Task · ${siteMap[t.site_id] ?? 'Unknown site'}`,
      tag:       t.workflow_status.replace('_', ' '),
      tagIntent: workflowIntent(t.workflow_status),
      href:      `/tasks`,
    })),
    ...assets.map(a => ({
      id:        a.id,
      type:      'asset' as EntityType,
      title:     a.name,
      subtitle:  `Asset · ${a.asset_type} · ${a.status}`,
      tag:       a.status,
      tagIntent: 'none' as Intent,
      href:      `/assets`,
    })),
  ]

  return candidates
    .map(r => ({ result: r, s: score(r, query) }))
    .filter(({ s }) => s >= 0)
    .sort((a, b) => b.s - a.s)
    .map(({ result }) => result)
    .slice(0, 20)
}

// ---------------------------------------------------------------------------
// Icon per entity type
// ---------------------------------------------------------------------------
function typeIcon(t: EntityType) {
  switch (t) {
    case 'site':  return 'map-marker'
    case 'task':  return 'th-list'
    case 'asset': return 'cube'
  }
}

// ---------------------------------------------------------------------------
// GlobalSearch
// ---------------------------------------------------------------------------
interface Props {
  open: boolean
  onClose: () => void
}

export default function GlobalSearch({ open, onClose }: Props) {
  const navigate  = useNavigate()
  const inputRef  = useRef<HTMLInputElement>(null)
  const listRef   = useRef<HTMLUListElement>(null)

  const [query,    setQuery]    = useState('')
  const [selected, setSelected] = useState(0)

  // Fetch all data — React Query returns from cache instantly if already loaded
  const sitesQuery  = useSites({ per_page: 200 })
  const tasksQuery  = useTasks({ per_page: 200 })
  const assetsQuery = useAssets({ per_page: 200 })

  const sites  = sitesQuery.data?.data  ?? []
  const tasks  = tasksQuery.data?.data  ?? []
  const assets = assetsQuery.data?.data ?? []

  const results = useMemo(
    () => buildResults(sites, tasks, assets, query),
    [sites, tasks, assets, query],
  )

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Reset selection when results change
  useEffect(() => { setSelected(0) }, [results.length])

  // Scroll selected item into view
  useEffect(() => {
    const item = listRef.current?.children[selected] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(s => Math.min(s + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(s => Math.max(s - 1, 0))
    } else if (e.key === 'Enter' && results[selected]) {
      navigate(results[selected].href)
      onClose()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  function handleSelect(result: SearchResult) {
    navigate(result.href)
    onClose()
  }

  if (!open) return null

  // Group results by type for display
  const grouped: Record<EntityType, SearchResult[]> = { site: [], task: [], asset: [] }
  for (const r of results) grouped[r.type].push(r)

  const flatOrder: SearchResult[] = [
    ...grouped.site,
    ...grouped.task,
    ...grouped.asset,
  ]

  // Map flat index back to original results order for keyboard nav
  let flatIndex = 0

  return (
    <div className="gs-backdrop" onClick={onClose}>
      <div className="gs-modal bp6-dark" onClick={e => e.stopPropagation()}>
        <div className="gs-input-row">
          <Icon icon="search" className="gs-search-icon" />
          <input
            ref={inputRef}
            className="gs-input"
            placeholder="Search sites, tasks, assets…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="gs-esc-hint">esc</kbd>
        </div>

        {query.trim() && (
          <ul ref={listRef} className="gs-results">
            {results.length === 0 && (
              <li className="gs-empty">No results for "{query}"</li>
            )}

            {(['site', 'task', 'asset'] as EntityType[]).map(type => {
              const group = grouped[type]
              if (group.length === 0) return null
              return (
                <li key={type} className="gs-group">
                  <span className="gs-group-label">
                    {type === 'site' ? 'Sites' : type === 'task' ? 'Tasks' : 'Assets'}
                  </span>
                  <ul>
                    {group.map(result => {
                      const idx = flatOrder.indexOf(result)
                      const isSelected = idx === selected
                      flatIndex++
                      return (
                        <li
                          key={result.id}
                          className={`gs-item ${isSelected ? 'gs-item--selected' : ''}`}
                          onClick={() => handleSelect(result)}
                          onMouseEnter={() => setSelected(idx)}
                        >
                          <Icon icon={typeIcon(result.type)} className="gs-item-icon" />
                          <div className="gs-item-text">
                            <span className="gs-item-title">{result.title}</span>
                            <span className="gs-item-subtitle bp6-text-muted">{result.subtitle}</span>
                          </div>
                          {result.tag && (
                            <Tag minimal small intent={result.tagIntent}>
                              {result.tag}
                            </Tag>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </li>
              )
            })}
          </ul>
        )}

        {!query.trim() && (
          <div className="gs-hint">
            <span>Type to search across all entities</span>
            <span className="bp6-text-muted gs-hint-keys">
              <kbd>↑↓</kbd> navigate &nbsp; <kbd>↵</kbd> open &nbsp; <kbd>esc</kbd> close
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
