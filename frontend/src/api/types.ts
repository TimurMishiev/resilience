// ---------------------------------------------------------------------------
// Domain types — mirror the OpenAPI component schemas
// ---------------------------------------------------------------------------

export type SiteStatus = 'active' | 'inactive'
export type ThreatLevel = 'green' | 'amber' | 'red' | 'black'

export interface GeoJsonPolygon {
  type: 'Polygon'
  coordinates: number[][][]   // [[[lng, lat], ...]]
}

export interface AreaOfOperation {
  id: string
  name: string
  description: string | null
  threat_level: ThreatLevel
  color: string               // hex e.g. "#ff4757"
  geometry: GeoJsonPolygon
  created_by: string
  created_at: string
  updated_at: string
}

export interface CreateAreaOfOperationBody {
  name: string
  description?: string | null
  threat_level: ThreatLevel
  color: string
  geometry: GeoJsonPolygon
}

export interface UpdateAreaOfOperationBody {
  name?: string
  description?: string | null
  threat_level?: ThreatLevel
  color?: string
  geometry?: GeoJsonPolygon
}

export interface AreasOfOperationParams extends PaginationParams {
  threat_level?: ThreatLevel
}
export type AssetStatus = 'available' | 'in_use' | 'maintenance' | 'offline'
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical'
export type WorkflowStatus = 'new' | 'triaged' | 'in_progress' | 'blocked' | 'resolved'

export interface Site {
  id: string
  name: string
  latitude: number | string  // Rails serializes decimal columns as strings
  longitude: number | string
  status: SiteStatus
  area_of_operation_id: string | null
  flagged_at: string | null
  flag_reason: string | null
  created_at: string
  updated_at: string
}

export interface Asset {
  id: string
  name: string
  asset_type: string
  status: AssetStatus
  home_site_id: string | null
  created_at: string
  updated_at: string
}

export interface Task {
  id: string
  site_id: string
  asset_id: string | null
  title: string
  description: string | null
  priority: TaskPriority
  workflow_status: WorkflowStatus
  blocked_reason: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface AuditEvent {
  id: string
  schema_version: number
  actor: string
  entity_type: string
  entity_id: string
  event_type: string
  action: string | null
  before_snapshot: Record<string, unknown> | null
  after_snapshot: Record<string, unknown>
  metadata: Record<string, unknown> | null
  correlation_id: string
  occurred_at: string
}

export interface ReadinessScore {
  score: number | null
  total_tasks: number
  resolved_tasks: number
  blocked_tasks: number
}

// ---------------------------------------------------------------------------
// Pagination wrapper — matches { data: T[], meta: { ... } }
// ---------------------------------------------------------------------------

export interface PaginationMeta {
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: PaginationMeta
}

// ---------------------------------------------------------------------------
// Request body shapes
// ---------------------------------------------------------------------------

export interface CreateTaskBody {
  site_id: string
  asset_id?: string | null
  title: string
  description?: string | null
  priority?: TaskPriority
}

export interface UpdateTaskBody {
  title?: string
  description?: string | null
  priority?: TaskPriority
}

export interface TransitionTaskBody {
  to_status: WorkflowStatus
  blocked_reason?: string | null
}

// ---------------------------------------------------------------------------
// Query param shapes
// ---------------------------------------------------------------------------

export interface PaginationParams {
  page?: number
  per_page?: number
}

export interface AsOfParam {
  as_of?: string
}

// ---------------------------------------------------------------------------
// AI types
// ---------------------------------------------------------------------------

export interface AiFilterResult {
  original_query: string
  filters: {
    site_id: string | null
    workflow_status: WorkflowStatus | null
    priority: TaskPriority | null
    created_after: string | null
    created_before: string | null
  }
}

export type AiSummaryType = 'site_activity' | 'readiness_change' | 'leadership_briefing'

export interface AiSummaryRequest {
  summary_type: AiSummaryType
  site_id?: string | null
  from?: string | null
  to?: string | null
}

export interface AiSummaryResult {
  summary: string
  citations: string[]
}

// ---------------------------------------------------------------------------
// Signal types
// ---------------------------------------------------------------------------

export type SignalSource = 'opensky' | 'ais' | 'usgs_seismic' | 'gpsjam' | 'firms_wildfire' | 'manual'
export type SignalType = 'aircraft_position' | 'vessel_position' | 'seismic_event' | 'gps_jamming' | 'wildfire' | 'manual'

export interface Signal {
  id: string
  source: SignalSource
  signal_type: SignalType
  external_id: string
  lat: string | number
  lng: string | number
  altitude: string | number | null
  speed: string | number | null
  heading: string | number | null
  magnitude: string | number | null
  raw_payload: Record<string, unknown>
  occurred_at: string
  ingested_at: string
}

export interface CorrelationConditions {
  signal_type?: SignalType | null
  proximity_km?: number | null
  site_id?: string | null
  magnitude_min?: number | null
  count_threshold?: number | null
  time_window_minutes?: number | null
}

export interface CorrelationActions {
  create_task?: {
    title?: string
    description?: string
    priority?: TaskPriority
  }
  escalate_task?: {
    title?: string
    min_priority?: TaskPriority
  }
  flag_site?: {
    reason?: string
  }
}

export interface CorrelationRule {
  id: string
  name: string
  description: string | null
  is_active: boolean
  conditions: CorrelationConditions
  actions: CorrelationActions
  created_by: string
  area_of_operation_id: string | null
  cooldown_minutes: number
  last_fired_at: string | null
  created_at: string
  updated_at: string
}

export interface SignalRuleMatch {
  id: string
  fired_at: string
  metadata: Record<string, unknown>
  signal: {
    id: string
    source: SignalSource
    signal_type: SignalType
    lat: string | number
    lng: string | number
    occurred_at: string
  } | null
  correlation_rule: { id: string; name: string } | null
  site: { id: string; name: string } | null
  task: {
    id: string
    title: string
    workflow_status: WorkflowStatus
    priority: TaskPriority
  } | null
}

export interface CreateCorrelationRuleBody {
  name: string
  description?: string | null
  is_active?: boolean
  conditions: CorrelationConditions
  actions: CorrelationActions
  cooldown_minutes?: number
}

export interface UpdateCorrelationRuleBody {
  name?: string
  description?: string | null
  is_active?: boolean
  conditions?: CorrelationConditions
  actions?: CorrelationActions
  cooldown_minutes?: number
}

export interface SignalsParams extends PaginationParams {
  source?: SignalSource
  signal_type?: SignalType
  from?: string
  to?: string
  site_id?: string
}

export interface SignalRuleMatchesParams extends PaginationParams {
  rule_id?: string
  site_id?: string
  from?: string
  to?: string
}

// ---------------------------------------------------------------------------
// Analytics types
// ---------------------------------------------------------------------------

export interface SiteReadiness {
  site_id: string
  site_name: string
  score: number | null
  counts: {
    total: number
    resolved: number
    blocked: number
    in_progress: number
    new: number
    triaged: number
  }
  computed_at: string
  as_of: string | null
}

export interface ThroughputPoint {
  date: string
  resolved: number
}
