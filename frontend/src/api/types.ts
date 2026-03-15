// ---------------------------------------------------------------------------
// Domain types — mirror the OpenAPI component schemas
// ---------------------------------------------------------------------------

export type SiteStatus = 'active' | 'inactive'
export type AssetStatus = 'available' | 'in_use' | 'maintenance' | 'offline'
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical'
export type WorkflowStatus = 'new' | 'triaged' | 'in_progress' | 'blocked' | 'resolved'

export interface Site {
  id: string
  name: string
  latitude: number | string  // Rails serializes decimal columns as strings
  longitude: number | string
  status: SiteStatus
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
