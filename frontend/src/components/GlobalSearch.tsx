import { useEffect, useMemo, useRef, useState, startTransition } from 'react'
import { Icon, Tag } from '@blueprintjs/core'
import type { IconName } from '@blueprintjs/icons'
import type { Intent } from '@blueprintjs/core'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSites } from '../hooks/useSites'
import { useTasks } from '../hooks/useTasks'
import { useAssets } from '../hooks/useAssets'
import { useReplayParams } from '../hooks/useReplayParams'
import { humanize } from '../utils/humanize'
import { workflowIntent } from '../lib/taskIntents'
import { buildMapGlobeSelectionPath } from '../lib/entitySelectionRoute'
import type { Site, Task, Asset } from '../api/types'

type ResultType = 'command' | 'site' | 'task' | 'asset'

interface SearchResult {
  id: string
  type: ResultType
  title: string
  subtitle: string
  icon: IconName
  href?: string
  keywords?: string[]
  tag?: string
  tagIntent?: Intent
  action?: 'logout'
}

interface Props {
  open: boolean
  isCommander: boolean
  onClose: () => void
  onLogout: () => void
}

function score(result: SearchResult, query: string): number {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return 0

  const title = result.title.toLowerCase()
  const subtitle = result.subtitle.toLowerCase()
  const keywords = (result.keywords ?? []).join(' ').toLowerCase()

  let value = -1
  if (title === normalizedQuery) value = 5
  else if (title.startsWith(normalizedQuery)) value = 4
  else if (title.includes(normalizedQuery)) value = 3
  else if (subtitle.includes(normalizedQuery)) value = 2
  else if (keywords.includes(normalizedQuery)) value = 1

  if (value >= 0 && result.type === 'command') value += 0.25
  return value
}

function buildCommandResults({
  isCommander,
  mapPath,
  globePath,
}: {
  isCommander: boolean
  mapPath: string
  globePath: string
}): SearchResult[] {
  const base: SearchResult[] = [
    {
      id: 'command-dashboard',
      type: 'command',
      title: 'Open Dashboard',
      subtitle: 'Command · Mission overview and posture',
      icon: 'dashboard',
      href: '/dashboard',
      keywords: ['home', 'overview', 'mission'],
    },
    {
      id: 'command-map',
      type: 'command',
      title: 'Open Map',
      subtitle: 'Command · 2D operational map',
      icon: 'globe',
      href: mapPath,
      keywords: ['maplibre', '2d', 'tactical map'],
    },
    {
      id: 'command-globe',
      type: 'command',
      title: 'Open Globe',
      subtitle: 'Command · 3D operational globe',
      icon: 'globe-network',
      href: globePath,
      keywords: ['cesium', '3d', 'earth'],
    },
    {
      id: 'command-incidents',
      type: 'command',
      title: 'Open Incidents',
      subtitle: 'Command · Incident queue and response ownership',
      icon: 'warning-sign',
      href: '/incidents',
      keywords: ['incident queue', 'response', 'triage'],
    },
    {
      id: 'command-alerts',
      type: 'command',
      title: 'Open Alert Triage',
      subtitle: 'Command · Rule fires and alert workflow',
      icon: 'notifications',
      href: '/alerts',
      keywords: ['alerts', 'rule fires', 'triage'],
    },
    {
      id: 'command-signals',
      type: 'command',
      title: 'Open Signals',
      subtitle: 'Command · Live signal feed',
      icon: 'feed',
      href: '/signals',
      keywords: ['feed', 'signals', 'sensor feed'],
    },
    {
      id: 'command-tasks',
      type: 'command',
      title: 'Open Tasks',
      subtitle: 'Command · Task queue and workflow',
      icon: 'th-list',
      href: '/tasks',
      keywords: ['tasking', 'workflow', 'queue'],
    },
    {
      id: 'command-sites',
      type: 'command',
      title: 'Open Sites',
      subtitle: 'Command · Site roster and readiness',
      icon: 'map-marker',
      href: '/sites',
      keywords: ['facilities', 'sites', 'readiness'],
    },
    {
      id: 'command-assets',
      type: 'command',
      title: 'Open Assets',
      subtitle: 'Command · Fleet and asset availability',
      icon: 'cube',
      href: '/assets',
      keywords: ['fleet', 'availability', 'platforms'],
    },
    {
      id: 'command-recommendations',
      type: 'command',
      title: 'Open Recommendations',
      subtitle: 'Command · Recommended actions and execution',
      icon: 'lightbulb',
      href: '/recommendations',
      keywords: ['courses of action', 'coa', 'recommendations'],
    },
    {
      id: 'command-graph',
      type: 'command',
      title: 'Open Graph',
      subtitle: 'Command · Entity graph and relationships',
      icon: 'graph',
      href: '/graph',
      keywords: ['relationships', 'graph', 'network'],
    },
    {
      id: 'command-signout',
      type: 'command',
      title: 'Sign out',
      subtitle: 'Action · End the current session',
      icon: 'log-out',
      action: 'logout',
      keywords: ['logout', 'log out', 'exit', 'sign off'],
      tag: 'Action',
      tagIntent: 'warning',
    },
  ]

  if (!isCommander) return base

  return [
    ...base.slice(0, 10),
    {
      id: 'command-briefing',
      type: 'command',
      title: 'Open Briefing',
      subtitle: 'Command · Commander AI briefing surface',
      icon: 'predictive-analysis',
      href: '/briefing',
      keywords: ['briefing', 'summary', 'intel brief'],
    },
    {
      id: 'command-rules',
      type: 'command',
      title: 'Open Rules',
      subtitle: 'Command · Correlation rules and compound logic',
      icon: 'lightning',
      href: '/rules',
      keywords: ['rules', 'correlation', 'compound rules'],
    },
    {
      id: 'command-areas',
      type: 'command',
      title: 'Open Areas',
      subtitle: 'Command · Areas of operation and posture',
      icon: 'polygon-filter',
      href: '/areas',
      keywords: ['ao', 'areas of operation', 'posture'],
    },
    {
      id: 'command-planning',
      type: 'command',
      title: 'Open Planning',
      subtitle: 'Command · Commander doctrine and chokepoints',
      icon: 'gantt-chart',
      href: '/planning',
      keywords: ['planning', 'pace', 'salute', 'commander intent', 'chokepoints'],
      tag: 'Commander',
      tagIntent: 'warning',
    },
    ...base.slice(10),
  ]
}

function buildResults(
  commands: SearchResult[],
  sites: Site[],
  tasks: Task[],
  assets: Asset[],
  query: string,
): SearchResult[] {
  const normalizedQuery = query.trim()
  const siteMap: Record<string, string> = {}
  for (const site of sites) siteMap[site.id] = site.name

  const entityResults: SearchResult[] = normalizedQuery
    ? [
        ...sites.map(site => ({
          id: site.id,
          type: 'site' as const,
          title: site.name,
          subtitle: `Site · ${site.status}`,
          icon: 'map-marker' as const,
          tag: site.status,
          tagIntent: (site.status === 'active' ? 'success' : 'none') as Intent,
          href: `/sites/${site.id}`,
          keywords: ['site', 'readiness', site.status],
        })),
        ...tasks.map(task => ({
          id: task.id,
          type: 'task' as const,
          title: task.title,
          subtitle: `Task · ${siteMap[task.site_id] ?? 'Unknown site'} · jump to task`,
          icon: 'th-list' as const,
          tag: humanize(task.workflow_status),
          tagIntent: workflowIntent(task.workflow_status),
          href: `/sites/${task.site_id}?task=${task.id}`,
          keywords: ['task', task.priority, task.workflow_status, siteMap[task.site_id] ?? ''],
        })),
        ...assets.map(asset => ({
          id: asset.id,
          type: 'asset' as const,
          title: asset.name,
          subtitle: `Asset · ${asset.asset_type} · ${asset.status}`,
          icon: 'cube' as const,
          tag: asset.status,
          tagIntent: 'none' as Intent,
          href: asset.home_site_id ? `/sites/${asset.home_site_id}` : '/assets',
          keywords: ['asset', asset.asset_type, asset.status],
        })),
      ]
    : []

  const candidates = normalizedQuery ? [...commands, ...entityResults] : commands
  if (!normalizedQuery) return candidates

  return candidates
    .map((result, index) => ({ result, index, relevance: score(result, normalizedQuery) }))
    .filter(entry => entry.relevance >= 0)
    .sort((left, right) => right.relevance - left.relevance || left.index - right.index)
    .map(entry => entry.result)
    .slice(0, 24)
}

function groupLabel(type: ResultType) {
  switch (type) {
    case 'command': return 'Commands'
    case 'site': return 'Sites'
    case 'task': return 'Tasks'
    case 'asset': return 'Assets'
  }
}

export default function GlobalSearch({ open, isCommander, onClose, onLogout }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const { asOfParam } = useReplayParams()

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)

  const shouldLoadEntities = open && query.trim().length > 0
  const sitesQuery = useSites({ per_page: 200, ...asOfParam }, shouldLoadEntities)
  const tasksQuery = useTasks({ per_page: 200, ...asOfParam }, shouldLoadEntities)
  const assetsQuery = useAssets({ per_page: 200, ...asOfParam }, shouldLoadEntities)

  const preserveEntitySelection = location.pathname.startsWith('/map') || location.pathname.startsWith('/globe')
  const mapPath = preserveEntitySelection ? buildMapGlobeSelectionPath('/map', location.search) : '/map'
  const globePath = preserveEntitySelection ? buildMapGlobeSelectionPath('/globe', location.search) : '/globe'

  const commandResults = useMemo(
    () => buildCommandResults({ isCommander, mapPath, globePath }),
    [globePath, isCommander, mapPath],
  )
  const results = useMemo(
    () => buildResults(
      commandResults,
      sitesQuery.data?.data ?? [],
      tasksQuery.data?.data ?? [],
      assetsQuery.data?.data ?? [],
      query,
    ),
    [assetsQuery.data?.data, commandResults, query, sitesQuery.data?.data, tasksQuery.data?.data],
  )

  useEffect(() => {
    if (!open) return
    startTransition(() => {
      setQuery('')
      setSelected(0)
    })
    window.setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    startTransition(() => setSelected(0))
  }, [results.length, query])

  useEffect(() => {
    const item = listRef.current?.children[selected] as HTMLElement | undefined
    if (typeof item?.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])

  function executeResult(result: SearchResult) {
    if (result.action === 'logout') {
      onClose()
      onLogout()
      return
    }

    if (result.href) {
      navigate(result.href)
      onClose()
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected(current => Math.min(current + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected(current => Math.max(current - 1, 0))
    } else if (event.key === 'Enter' && results[selected]) {
      executeResult(results[selected])
    } else if (event.key === 'Escape') {
      onClose()
    }
  }

  if (!open) return null

  const grouped: Record<ResultType, SearchResult[]> = { command: [], site: [], task: [], asset: [] }
  for (const result of results) grouped[result.type].push(result)

  const flatOrder: SearchResult[] = [
    ...grouped.command,
    ...grouped.site,
    ...grouped.task,
    ...grouped.asset,
  ]

  return (
    <div className="gs-backdrop" onClick={onClose}>
      <div className="gs-modal bp6-dark" onClick={event => event.stopPropagation()}>
        <div className="gs-input-row">
          <Icon icon="search" className="gs-search-icon" />
          <input
            ref={inputRef}
            className="gs-input"
            placeholder="Search commands, pages, sites, tasks, assets…"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="gs-esc-hint">esc</kbd>
        </div>

        <ul ref={listRef} className="gs-results">
          {results.length === 0 && query.trim() && (
            <li className="gs-empty">No results for "{query}"</li>
          )}

          {(['command', 'site', 'task', 'asset'] as ResultType[]).map(type => {
            const group = grouped[type]
            if (group.length === 0) return null

            return (
              <li key={type} className="gs-group">
                <span className="gs-group-label">{groupLabel(type)}</span>
                <ul>
                  {group.map(result => {
                    const idx = flatOrder.indexOf(result)
                    const isSelected = idx === selected
                    return (
                      <li
                        key={result.id}
                        className={`gs-item ${isSelected ? 'gs-item--selected' : ''}`}
                        onClick={() => executeResult(result)}
                        onMouseEnter={() => setSelected(idx)}
                      >
                        <Icon icon={result.icon} className="gs-item-icon" />
                        <div className="gs-item-text">
                          <span className="gs-item-title">{result.title}</span>
                          <span className="gs-item-subtitle bp6-text-muted">{result.subtitle}</span>
                        </div>
                        {result.tag && (
                          <Tag minimal intent={result.tagIntent}>
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

        {!query.trim() && (
          <div className="gs-hint">
            <span>Top commands are shown immediately. Start typing to narrow pages, actions, and entities.</span>
            <span className="bp6-text-muted gs-hint-keys">
              <kbd>↑↓</kbd> navigate &nbsp; <kbd>↵</kbd> run &nbsp; <kbd>esc</kbd> close
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
