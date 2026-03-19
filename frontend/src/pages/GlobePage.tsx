import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { Button, Divider, Tag, Spinner } from '@blueprintjs/core'
import { useSites } from '../hooks/useSites'
import { useTasks } from '../hooks/useTasks'
import { useAssets } from '../hooks/useAssets'
import { useTelemetryStream } from '../hooks/useTelemetryStream'
import { useAreasOfOperation } from '../hooks/useAreasOfOperation'
import { useSignals } from '../hooks/useSignals'
import { useReplay } from '../context/ReplayContext'
import type { Site, Task, WorkflowStatus } from '../api/types'
import type { Intent } from '@blueprintjs/core'
import { SIGNAL_ICON_CHAR } from '../lib/signalIcons'

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

const GLOBE_SIGNAL_COLORS: Record<string, Cesium.Color> = {
  aircraft_position: Cesium.Color.fromCssColorString('#00d4ff'),
  vessel_position:   Cesium.Color.fromCssColorString('#00c4a0'),
  seismic_event:     Cesium.Color.fromCssColorString('#ff8c42'),
  gps_jamming:       Cesium.Color.fromCssColorString('#ffd700'),
  wildfire:          Cesium.Color.fromCssColorString('#ff4422'),
  manual:            Cesium.Color.fromCssColorString('#8f99a8'),
}

const GLOBE_SIGNAL_LABELS: Record<string, string> = {
  aircraft_position: 'Aircraft',
  vessel_position:   'Vessel',
  seismic_event:     'Seismic',
  gps_jamming:       'GPS Jam',
  wildfire:          'Wildfire',
  manual:            'Manual',
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
  const { data: areasRes } = useAreasOfOperation({ per_page: 200 })
  const { data: signalsRes } = useSignals({ per_page: 200 })

  const sites  = useMemo(() => sitesQuery.data?.data  ?? [], [sitesQuery.data?.data])
  const tasks  = useMemo(() => tasksQuery.data?.data  ?? [], [tasksQuery.data?.data])
  const assets = useMemo(() => assetsQuery.data?.data ?? [], [assetsQuery.data?.data])
  const areaOfOperations = useMemo(() => areasRes?.data ?? [], [areasRes?.data])
  const signals = useMemo(() => signalsRes?.data ?? [], [signalsRes?.data])
  const loading = sitesQuery.isLoading || tasksQuery.isLoading

  const { readings } = useTelemetryStream(!isReplaying)

  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef    = useRef<Cesium.Viewer | null>(null)
  // site entity refs for color updates
  const siteEntitiesRef  = useRef<Map<string, Cesium.Entity>>(new Map())
  // asset entity refs for position updates
  const assetEntitiesRef = useRef<Map<string, Cesium.Entity>>(new Map())
  // AO entity refs
  const aoEntitiesRef    = useRef<Map<string, Cesium.Entity>>(new Map())
  const signalEntitiesRef = useRef<Cesium.Entity[]>([])
  const isRotatingRef    = useRef(true)

  const [selectedSite, setSelectedSite]   = useState<Site | null>(null)
  const [selectedTasks, setSelectedTasks] = useState<Task[]>([])
  const [showSignals, setShowSignals]     = useState(true)

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

    // ESRI World Imagery — satellite basemap, no API key required
    const osmProvider = new Cesium.UrlTemplateImageryProvider({
      url:          'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maximumLevel: 19,
      credit:       new Cesium.Credit('© Esri, Maxar, Earthstar Geographics'),
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
    viewer.scene.backgroundColor = Cesium.Color.BLACK
    viewer.scene.globe.enableLighting = true
    viewer.scene.globe.showGroundAtmosphere = true
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0a0f1a')
    // Atmosphere glow for realism
    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.show = true
      viewer.scene.skyAtmosphere.atmosphereLightIntensity = 20.0
      viewer.scene.skyAtmosphere.atmosphereRayleighScaleHeight = 12000
    }
    // Soft fog for depth
    viewer.scene.fog.enabled = false
    // Deeper space background
    if (viewer.scene.skyBox) {
      viewer.scene.skyBox.show = true
    }

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

    // Slow auto-rotation — stop when site selected
    const onTickFn = () => {
      if (isRotatingRef.current) {
        viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, Cesium.Math.toRadians(0.008))
      }
    }
    viewer.clock.onTick.addEventListener(onTickFn)

    // Capture ref values so the cleanup function uses the same Map instances
    const siteEntities  = siteEntitiesRef.current
    const assetEntities = assetEntitiesRef.current
    const aoEntities    = aoEntitiesRef.current

    return () => {
      viewer.clock.onTick.removeEventListener(onTickFn)
      viewer.destroy()
      viewerRef.current = null
      siteEntities.clear()
      assetEntities.clear()
      aoEntities.clear()
      signalEntitiesRef.current = []
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
          pixelSize:               16,
          color:                   color,
          outlineColor:            Cesium.Color.WHITE.withAlpha(0.8),
          outlineWidth:            2,
          disableDepthTestDistance: 1e7,
          scaleByDistance:         new Cesium.NearFarScalar(1e5, 1.5, 8e6, 0.8),
        },
        label: {
          text:                    site.name,
          font:                    '600 12px "system-ui", sans-serif',
          fillColor:               Cesium.Color.WHITE,
          outlineColor:            Cesium.Color.BLACK,
          outlineWidth:            2,
          style:                   Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:             new Cesium.Cartesian2(0, -22),
          disableDepthTestDistance: 1e7,
          translucencyByDistance:  new Cesium.NearFarScalar(1e6, 1.0, 8e6, 0.0),
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
        position: Cesium.Cartesian3.fromDegrees(lng, lat),
        point: {
          pixelSize:               10,
          color:                   Cesium.Color.CYAN.withAlpha(0.95),
          outlineColor:            Cesium.Color.WHITE.withAlpha(0.7),
          outlineWidth:            2,
          disableDepthTestDistance: 1e7,
        },
        label: {
          text:                    asset.name,
          font:                    '500 10px "system-ui", sans-serif',
          fillColor:               Cesium.Color.CYAN,
          outlineColor:            Cesium.Color.BLACK,
          outlineWidth:            2,
          style:                   Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:             new Cesium.Cartesian2(0, -16),
          disableDepthTestDistance: 1e7,
          translucencyByDistance:  new Cesium.NearFarScalar(5e5, 1.0, 3e6, 0.0),
        },
      })

      assetEntitiesRef.current.set(key, entity)
    }
  }, [assets, sites])

  // -------------------------------------------------------------------------
  // AO polygon entities — translucent fill + outline
  // -------------------------------------------------------------------------
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    // Remove AOs that no longer exist
    const currentIds = new Set(areaOfOperations.map(ao => `ao-${ao.id}`))
    for (const [key, entity] of aoEntitiesRef.current) {
      if (!currentIds.has(key)) {
        viewer.entities.remove(entity)
        aoEntitiesRef.current.delete(key)
      }
    }

    for (const ao of areaOfOperations) {
      const key = `ao-${ao.id}`
      if (aoEntitiesRef.current.has(key)) continue

      const coords    = ao.geometry.coordinates[0]  // [[lng, lat], ...]
      const flat      = coords.flatMap(([lng, lat]: number[]) => [lng, lat])
      const positions = Cesium.Cartesian3.fromDegreesArray(flat)
      const fillColor = Cesium.Color.fromCssColorString(ao.color).withAlpha(0.15)
      const lineColor = Cesium.Color.fromCssColorString(ao.color).withAlpha(0.8)

      const entity = viewer.entities.add({
        id:   key,
        name: ao.name,
        polygon: {
          hierarchy:    new Cesium.PolygonHierarchy(positions),
          material:     fillColor,
          outline:      new Cesium.ConstantProperty(true),
          outlineColor: new Cesium.ConstantProperty(lineColor),
          outlineWidth: new Cesium.ConstantProperty(2),
          height:       new Cesium.ConstantProperty(0),
        },
      })

      aoEntitiesRef.current.set(key, entity)
    }
  }, [areaOfOperations])

  // -------------------------------------------------------------------------
  // Signal entities — rebuild on signal data or visibility change
  // -------------------------------------------------------------------------
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    // Remove all old signal entities
    for (const entity of signalEntitiesRef.current) {
      viewer.entities.remove(entity)
    }
    signalEntitiesRef.current = []

    if (!showSignals) return

    for (const signal of signals) {
      const color = GLOBE_SIGNAL_COLORS[signal.signal_type] ?? Cesium.Color.WHITE
      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(Number(signal.lng), Number(signal.lat)),
        point: {
          pixelSize:               7,
          color:                   color.withAlpha(0.95),
          outlineColor:            color.withAlpha(0.35),
          outlineWidth:            5,
          disableDepthTestDistance: 1e7,
          scaleByDistance:         new Cesium.NearFarScalar(5e4, 1.4, 6e6, 0.6),
        },
        label: {
          text:                    SIGNAL_ICON_CHAR[signal.signal_type] ?? '●',
          font:                    '11px sans-serif',
          fillColor:               Cesium.Color.WHITE,
          outlineColor:            Cesium.Color.BLACK,
          outlineWidth:            2,
          style:                   Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin:          Cesium.VerticalOrigin.BOTTOM,
          horizontalOrigin:        Cesium.HorizontalOrigin.CENTER,
          pixelOffset:             new Cesium.Cartesian2(0, -8),
          disableDepthTestDistance: 1e7,
          scaleByDistance:         new Cesium.NearFarScalar(5e4, 1.0, 3e6, 0.0),
          showBackground:          false,
        },
      })
      signalEntitiesRef.current.push(entity)
    }
  }, [signals, showSignals])

  // -------------------------------------------------------------------------
  // Update asset positions from live telemetry
  // -------------------------------------------------------------------------
  useEffect(() => {
    for (const [assetId, reading] of readings) {
      const entity = assetEntitiesRef.current.get(`asset-${assetId}`)
      if (entity) {
        entity.position = new Cesium.ConstantPositionProperty(
          Cesium.Cartesian3.fromDegrees(reading.lng, reading.lat)
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
      isRotatingRef.current = false

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
            isRotatingRef.current = true
          }}
        />
        <div
          className={`globe-signal-toggle${showSignals ? ' globe-signal-toggle--active' : ''}`}
          onClick={() => setShowSignals(v => !v)}
          role="button"
        >
          SIGNALS {showSignals ? 'ON' : 'OFF'}
        </div>
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
              onClick={() => { setSelectedSite(null); isRotatingRef.current = true }}
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
                    <Tag minimal intent={workflowIntent(t.workflow_status)}>
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
        <div className="globe-legend-section-title">SITES</div>
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
        {showSignals && (
          <>
            <div className="globe-legend-section-title" style={{ marginTop: 10 }}>SIGNALS</div>
            {Object.entries(GLOBE_SIGNAL_LABELS).map(([type, label]) => (
              <div key={type} className="globe-legend-item">
                <span className="globe-legend-dot" style={{ background: GLOBE_SIGNAL_COLORS[type].toCssHexString() }} />
                {label}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
