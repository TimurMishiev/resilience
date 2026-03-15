import { useEffect, useRef, useState, useCallback } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { Button, Divider, Tag, Spinner } from '@blueprintjs/core'
import { useSites } from '../hooks/useSites'
import { useTasks } from '../hooks/useTasks'
import { useAssets } from '../hooks/useAssets'
import { useTelemetryStream } from '../hooks/useTelemetryStream'
import { useReplay } from '../context/ReplayContext'
import type { Site, Task, WorkflowStatus } from '../api/types'
import type { Intent } from '@blueprintjs/core'

// Only set Ion token if explicitly provided — never set to empty string
// which blocks all rendering in Cesium 1.100+
const ionToken = import.meta.env['VITE_CESIUM_ION_TOKEN'] as string | undefined
if (ionToken) Cesium.Ion.defaultAccessToken = ionToken

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function workflowIntent(status: WorkflowStatus): Intent {
  switch (status) {
    case 'blocked':     return 'danger'
    case 'resolved':    return 'success'
    case 'in_progress': return 'primary'
    case 'triaged':     return 'warning'
    default:            return 'none'
  }
}

function siteColor(tasks: Task[], siteStatus: Site['status']): Cesium.Color {
  if (siteStatus === 'inactive') return Cesium.Color.GRAY
  if (tasks.length === 0)        return Cesium.Color.DODGERBLUE
  if (tasks.some(t => t.workflow_status === 'blocked'))  return Cesium.Color.RED
  if (tasks.every(t => t.workflow_status === 'resolved')) return Cesium.Color.LIMEGREEN
  if (tasks.some(t => t.workflow_status === 'in_progress')) return Cesium.Color.DODGERBLUE
  return Cesium.Color.ORANGE
}

function computeReadiness(tasks: Task[]): number | null {
  const total = tasks.length
  if (total === 0) return null
  const resolved   = tasks.filter(t => t.workflow_status === 'resolved').length
  const nonBlocked = tasks.filter(t => t.workflow_status !== 'blocked').length
  return (resolved / total) * 0.6 + (nonBlocked / total) * 0.4
}

// ---------------------------------------------------------------------------
// GlobePage
// ---------------------------------------------------------------------------
export default function GlobePage() {
  const { asOf, isReplaying } = useReplay()
  const asOfParam = asOf ? { as_of: asOf } : {}

  const sitesQuery  = useSites({ per_page: 200, ...asOfParam })
  const tasksQuery  = useTasks({ per_page: 200, ...asOfParam })
  const assetsQuery = useAssets({ per_page: 200, ...asOfParam })

  const sites  = sitesQuery.data?.data  ?? []
  const tasks  = tasksQuery.data?.data  ?? []
  const assets = assetsQuery.data?.data ?? []
  const loading = sitesQuery.isLoading || tasksQuery.isLoading

  const { readings } = useTelemetryStream(!isReplaying)

  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef    = useRef<Cesium.Viewer | null>(null)
  // site entity refs for color updates
  const siteEntitiesRef  = useRef<Map<string, Cesium.Entity>>(new Map())
  // asset entity refs for position updates
  const assetEntitiesRef = useRef<Map<string, Cesium.Entity>>(new Map())

  const [selectedSite, setSelectedSite]   = useState<Site | null>(null)
  const [selectedTasks, setSelectedTasks] = useState<Task[]>([])

  const tasksBySite: Record<string, Task[]> = {}
  for (const t of tasks) {
    if (!tasksBySite[t.site_id]) tasksBySite[t.site_id] = []
    tasksBySite[t.site_id].push(t)
  }

  // -------------------------------------------------------------------------
  // Init Cesium viewer once
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return

    // OSM imagery layer — constructor API works in all Cesium versions
    const osmProvider = new Cesium.UrlTemplateImageryProvider({
      url:          'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      maximumLevel: 19,
      credit:       new Cesium.Credit('© OpenStreetMap contributors'),
    })

    const viewer = new Cesium.Viewer(containerRef.current, {
      // `baseLayer` accepted in 1.104+; falls back gracefully in older builds
      baseLayer: Cesium.ImageryLayer.fromProviderAsync(
        Promise.resolve(osmProvider), {}
      ),
      // Flat ellipsoid — zero Ion dependency
      terrainProvider: new Cesium.EllipsoidTerrainProvider({}),
      // Disable all default UI — we build our own
      baseLayerPicker:      false,
      geocoder:             false,
      homeButton:           false,
      infoBox:              false,
      navigationHelpButton: false,
      sceneModePicker:      false,
      selectionIndicator:   false,
      timeline:             false,
      animation:            false,
      fullscreenButton:     false,
    })

    // Dark scene settings — no Ion-dependent features
    viewer.scene.backgroundColor    = Cesium.Color.BLACK
    viewer.scene.globe.enableLighting = true
    viewer.scene.globe.showGroundAtmosphere = true
    viewer.scene.globe.baseColor    = Cesium.Color.fromCssColorString('#1a2233')

    // Start with a full-Earth view looking straight down
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(10, 20, 18_000_000),
      orientation: {
        heading: 0,
        pitch:   Cesium.Math.toRadians(-90),
        roll:    0,
      },
    })

    viewerRef.current = viewer

    return () => {
      viewer.destroy()
      viewerRef.current = null
      siteEntitiesRef.current.clear()
      assetEntitiesRef.current.clear()
    }
  }, [])

  // -------------------------------------------------------------------------
  // Site entities — rebuild when sites/tasks change
  // -------------------------------------------------------------------------
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || sites.length === 0) return

    // Remove stale site entities
    const currentIds = new Set(sites.map(s => `site-${s.id}`))
    for (const [key, entity] of siteEntitiesRef.current) {
      if (!currentIds.has(key)) {
        viewer.entities.remove(entity)
        siteEntitiesRef.current.delete(key)
      }
    }

    for (const site of sites) {
      const siteTasks = tasksBySite[site.id] ?? []
      const color     = siteColor(siteTasks, site.status)
      const key       = `site-${site.id}`

      if (siteEntitiesRef.current.has(key)) {
        // Update color on existing entity
        const entity = siteEntitiesRef.current.get(key)!
        if (entity.point) {
          entity.point.color = new Cesium.ConstantProperty(color)
        }
        continue
      }

      const entity = viewer.entities.add({
        id:       key,
        name:     site.name,
        position: Cesium.Cartesian3.fromDegrees(
          Number(site.longitude),
          Number(site.latitude),
        ),
        point: {
          pixelSize:        14,
          color:            color,
          outlineColor:     Cesium.Color.WHITE.withAlpha(0.6),
          outlineWidth:     1.5,
          heightReference:  Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text:              site.name,
          font:              '600 12px "system-ui", sans-serif',
          fillColor:         Cesium.Color.WHITE,
          outlineColor:      Cesium.Color.BLACK,
          outlineWidth:      2,
          style:             Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:       new Cesium.Cartesian2(0, -22),
          heightReference:   Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          translucencyByDistance: new Cesium.NearFarScalar(1e6, 1.0, 8e6, 0.0),
        },
      })

      siteEntitiesRef.current.set(key, entity)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, tasks])

  // -------------------------------------------------------------------------
  // Asset entities — seeded from home site, moved by telemetry
  // -------------------------------------------------------------------------
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || assets.length === 0) return

    for (const asset of assets) {
      const key = `asset-${asset.id}`
      if (assetEntitiesRef.current.has(key)) continue

      const homeSite = sites.find(s => s.id === asset.home_site_id)
      const lat = homeSite ? Number(homeSite.latitude)  + (Math.random() - 0.5) * 0.05 : 0
      const lng = homeSite ? Number(homeSite.longitude) + (Math.random() - 0.5) * 0.05 : 0

      const entity = viewer.entities.add({
        id:       key,
        name:     asset.name,
        position: Cesium.Cartesian3.fromDegrees(lng, lat, 1000),
        point: {
          pixelSize:       8,
          color:           Cesium.Color.CYAN.withAlpha(0.9),
          outlineColor:    Cesium.Color.WHITE.withAlpha(0.4),
          outlineWidth:    1,
          heightReference: Cesium.HeightReference.NONE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text:              asset.name,
          font:              '500 10px "system-ui", sans-serif',
          fillColor:         Cesium.Color.CYAN,
          outlineColor:      Cesium.Color.BLACK,
          outlineWidth:      2,
          style:             Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:       new Cesium.Cartesian2(0, -16),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          translucencyByDistance: new Cesium.NearFarScalar(5e5, 1.0, 3e6, 0.0),
        },
      })

      assetEntitiesRef.current.set(key, entity)
    }
  }, [assets, sites])

  // -------------------------------------------------------------------------
  // Update asset positions from live telemetry
  // -------------------------------------------------------------------------
  useEffect(() => {
    for (const [assetId, reading] of readings) {
      const entity = assetEntitiesRef.current.get(`asset-${assetId}`)
      if (entity) {
        entity.position = new Cesium.ConstantPositionProperty(
          Cesium.Cartesian3.fromDegrees(reading.lng, reading.lat, 1000)
        )
      }
    }
  }, [readings])

  // -------------------------------------------------------------------------
  // Click handler — pick site entity, fly to it
  // -------------------------------------------------------------------------
  const handleClick = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(event.position)
      if (!Cesium.defined(picked) || !picked.id) return

      const entity: Cesium.Entity = picked.id
      if (!entity.id || !entity.id.startsWith('site-')) return

      const siteId = entity.id.replace('site-', '')
      const site   = sites.find(s => s.id === siteId)
      if (!site) return

      setSelectedSite(site)
      setSelectedTasks(tasksBySite[site.id] ?? [])

      // Fly to the site
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          Number(site.longitude),
          Number(site.latitude),
          1_200_000,
        ),
        orientation: {
          heading: 0,
          pitch:   Cesium.Math.toRadians(-70),
          roll:    0,
        },
        duration: 1.5,
      })
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return () => handler.destroy()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, tasks])

  useEffect(() => {
    const cleanup = handleClick()
    return cleanup
  }, [handleClick])

  const readiness = computeReadiness(selectedTasks)

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="globe-page">
      <div ref={containerRef} className="globe-container" />

      {loading && (
        <div className="globe-loading"><Spinner /></div>
      )}

      {/* ── Toolbar ── */}
      <div className="globe-toolbar bp6-dark">
        <span className="globe-toolbar-title">3D GLOBE</span>
        <Button
          small minimal icon="home"
          title="Reset view"
          onClick={() => {
            viewerRef.current?.camera.flyTo({
              destination: Cesium.Cartesian3.fromDegrees(10, 20, 18_000_000),
              orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
              duration: 1.5,
            })
            setSelectedSite(null)
          }}
        />
        <span className="globe-toolbar-hint bp6-text-muted">
          Click a site marker to fly to it
        </span>
      </div>

      {/* ── Site detail panel ── */}
      {selectedSite && (
        <div className="globe-panel bp6-dark">
          <div className="globe-panel-header">
            <span className="globe-panel-title">{selectedSite.name}</span>
            <button
              className="globe-panel-close bp6-button bp6-minimal bp6-icon-cross"
              onClick={() => setSelectedSite(null)}
              aria-label="Close"
            />
          </div>

          <div className="globe-panel-tags">
            <Tag minimal intent={selectedSite.status === 'active' ? 'success' : 'none'}>
              {selectedSite.status}
            </Tag>
            <Tag minimal>
              {selectedTasks.length} task{selectedTasks.length !== 1 ? 's' : ''}
            </Tag>
            {readiness !== null && (
              <Tag minimal intent={readiness >= 0.8 ? 'success' : readiness >= 0.5 ? 'warning' : 'danger'}>
                {Math.round(readiness * 100)}% ready
              </Tag>
            )}
          </div>

          <p className="globe-panel-coords bp6-text-muted">
            {Number(selectedSite.latitude).toFixed(4)},&nbsp;
            {Number(selectedSite.longitude).toFixed(4)}
          </p>

          {selectedTasks.length > 0 && (
            <>
              <Divider />
              <ul className="globe-task-list">
                {selectedTasks.map(t => (
                  <li key={t.id} className="globe-task-item">
                    <span className="globe-task-title">{t.title}</span>
                    <Tag minimal small intent={workflowIntent(t.workflow_status)}>
                      {t.workflow_status.replace('_', ' ')}
                    </Tag>
                  </li>
                ))}
              </ul>
            </>
          )}

          {selectedTasks.length === 0 && (
            <p className="bp6-text-muted globe-no-tasks">No tasks assigned.</p>
          )}
        </div>
      )}

      {/* ── Legend ── */}
      <div className="globe-legend bp6-dark">
        <div className="globe-legend-item">
          <span className="globe-legend-dot" style={{ background: '#ff4444' }} />Blocked
        </div>
        <div className="globe-legend-item">
          <span className="globe-legend-dot" style={{ background: '#32cd32' }} />Resolved
        </div>
        <div className="globe-legend-item">
          <span className="globe-legend-dot" style={{ background: '#1e90ff' }} />In progress
        </div>
        <div className="globe-legend-item">
          <span className="globe-legend-dot" style={{ background: '#00ffff' }} />Asset (live)
        </div>
      </div>
    </div>
  )
}
