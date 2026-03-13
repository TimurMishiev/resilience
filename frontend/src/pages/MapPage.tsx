import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Callout, Divider, Spinner, Tag } from '@blueprintjs/core'
import { getSites } from '../api/sites'
import { getTasks } from '../api/tasks'
import { useReplay } from '../context/ReplayContext'
import type { Site, Task } from '../api/types'
import type { Intent } from '@blueprintjs/core'

function workflowIntent(status: Task['workflow_status']): Intent {
  switch (status) {
    case 'blocked':     return 'danger'
    case 'resolved':    return 'success'
    case 'in_progress': return 'primary'
    case 'triaged':     return 'warning'
    default:            return 'none'
  }
}

function priorityIntent(priority: Task['priority']): Intent {
  switch (priority) {
    case 'critical': return 'danger'
    case 'high':     return 'warning'
    default:         return 'none'
  }
}

interface SiteDetail {
  site: Site
  tasks: Task[]
}

export default function MapPage() {
  const { asOf } = useReplay()
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])

  const [sites, setSites] = useState<Site[]>([])
  const [tasksBySite, setTasksBySite] = useState<Record<string, Task[]>>({})
  const [selected, setSelected] = useState<SiteDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Initialise map once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    mapRef.current = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [0, 20],
      zoom: 1.5,
    })

    mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-left')

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // Fetch sites + tasks whenever asOf changes
  useEffect(() => {
    setLoading(true)
    setError(null)
    setSelected(null)

    const params = asOf ? { as_of: asOf } : {}

    Promise.all([
      getSites({ per_page: 200, ...params }),
      getTasks({ per_page: 200, ...params }),
    ])
      .then(([siteRes, taskRes]) => {
        setSites(siteRes.data)

        const bysite: Record<string, Task[]> = {}
        for (const task of taskRes.data) {
          if (!bysite[task.site_id]) bysite[task.site_id] = []
          bysite[task.site_id].push(task)
        }
        setTasksBySite(bysite)
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Unknown error'),
      )
      .finally(() => setLoading(false))
  }, [asOf])

  // Place / replace markers whenever sites change
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Remove old markers
    for (const m of markersRef.current) m.remove()
    markersRef.current = []

    for (const site of sites) {
      const el = document.createElement('div')
      el.className = `map-marker ${site.status === 'active' ? 'map-marker--active' : 'map-marker--inactive'}`
      el.title = site.name

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([Number(site.longitude), Number(site.latitude)])
        .addTo(map)

      el.addEventListener('click', () => {
        setSelected({ site, tasks: tasksBySite[site.id] ?? [] })
      })

      markersRef.current.push(marker)
    }
  }, [sites, tasksBySite])

  return (
    <div className="map-page">
      {/* Map container */}
      <div ref={mapContainerRef} className="map-container" />

      {/* Loading overlay */}
      {loading && (
        <div className="map-overlay map-overlay--loading">
          <Spinner />
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="map-overlay map-overlay--error">
          <Callout intent="danger" title="Failed to load map data" compact>
            {error}
          </Callout>
        </div>
      )}

      {/* Site detail panel */}
      {selected && (
        <div className="map-panel bp6-dark">
          <div className="map-panel-header">
            <span className="map-panel-title">{selected.site.name}</span>
            <button
              className="map-panel-close bp6-button bp6-minimal bp6-icon-cross"
              onClick={() => setSelected(null)}
              aria-label="Close"
            />
          </div>

          <div className="map-panel-tags">
            <Tag minimal intent={selected.site.status === 'active' ? 'success' : 'none'}>
              {selected.site.status}
            </Tag>
            <Tag minimal>{selected.tasks.length} task{selected.tasks.length !== 1 ? 's' : ''}</Tag>
          </div>

          <p className="map-panel-coords bp6-text-muted">
            {Number(selected.site.latitude).toFixed(4)}, {Number(selected.site.longitude).toFixed(4)}
          </p>

          {selected.tasks.length > 0 && (
            <>
              <Divider />
              <ul className="map-task-list">
                {selected.tasks.map((task) => (
                  <li key={task.id} className="map-task-item">
                    <span className="map-task-title">{task.title}</span>
                    <div className="map-task-tags">
                      <Tag minimal small intent={workflowIntent(task.workflow_status)}>
                        {task.workflow_status.replace('_', ' ')}
                      </Tag>
                      <Tag minimal small intent={priorityIntent(task.priority)}>
                        {task.priority}
                      </Tag>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
