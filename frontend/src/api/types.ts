// ---------------------------------------------------------------------------
// Domain types — mirror the OpenAPI component schemas
// ---------------------------------------------------------------------------

export type SiteStatus = 'active' | 'inactive'
export type ThreatLevel = 'green' | 'amber' | 'red' | 'black'
export type Posture = 'observe' | 'defensive' | 'weapons_free'
export type ChokepointCategory = 'strait' | 'canal' | 'harbor_approach' | 'lane_constriction' | 'anchorage'
export type ChokepointStatus = 'monitor' | 'constrained' | 'contested' | 'closed'
export const POSTURES: Posture[] = ['observe', 'defensive', 'weapons_free']

export interface GeoJsonPolygon {
  type: 'Polygon'
  coordinates: number[][][]   // [[[lng, lat], ...]]
}

export interface AreaOfOperation {
  id: string
  name: string
  description: string | null
  threat_level: ThreatLevel
  posture: Posture
  posture_changed_at: string | null
  color: string               // hex e.g. "#ff4757"
  geometry: GeoJsonPolygon
  created_by_id: string
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

export interface AreasOfOperationParams extends PaginationParams, AsOfParam {
  threat_level?: ThreatLevel
}
export type AssetStatus = 'available' | 'assigned' | 'degraded' | 'offline'
export const ASSET_STATUSES: AssetStatus[] = ['available', 'assigned', 'degraded', 'offline']
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical'
export type WorkflowStatus = 'new' | 'triaged' | 'in_progress' | 'blocked' | 'resolved'

export interface Site {
  id: string
  name: string
  // Backend coerces Postgres numeric(9,6) → Float at the JSON boundary
  // (sites_controller.rb#serialize_site, audit 2026-05-01). Pre-fix the
  // shape was `number | string` to tolerate Rails' default
  // BigDecimal-as-string encoding.
  latitude: number
  longitude: number
  status: SiteStatus
  area_of_operation_id: string | null
  flagged_at: string | null
  flag_reason: string | null
  geofence_radius_km: number
  created_at: string
  updated_at: string
}

export interface Asset {
  id: string
  name: string
  asset_type: string
  status: AssetStatus
  home_site_id: string | null
  last_reported_at: string | null
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
  // Enriched fields — present on all task responses (null when site has no AO)
  site_name:  string | null
  ao_id:      string | null
  ao_posture: Posture | null
}

// ---------------------------------------------------------------------------
// Planning Surface types
// ---------------------------------------------------------------------------

export interface PlanningIncidentStub {
  id:          string
  title:       string
  severity:    string
  status:      string
  site_id:     string | null
  ao_id:       string | null
  assigned_to: { id: string; email: string; role: string } | null
}

export interface PlanningAoStub {
  id:      string
  name:    string
  posture: Posture
}

export interface Chokepoint {
  id: string
  area_of_operation_id: string
  area_of_operation_name: string
  name: string
  category: ChokepointCategory
  status: ChokepointStatus
  latitude: number
  longitude: number
  watch_radius_km: number
  notes: string | null
  created_by_id: string
  updated_by_id: string
  created_at: string
  updated_at: string
}

export interface CommanderIntent {
  id: string
  area_of_operation_id: string
  title: string
  objective: string
  end_state: string
  constraints: string | null
  created_by_id: string
  updated_by_id: string
  created_at: string
  updated_at: string
}

export interface PacePlan {
  id: string
  area_of_operation_id: string
  primary_plan: string
  alternate_plan: string
  contingency_plan: string
  emergency_plan: string
  notes: string | null
  created_by_id: string
  updated_by_id: string
  created_at: string
  updated_at: string
}

export interface SaluteReport {
  id: string
  area_of_operation_id: string
  area_of_operation_name: string
  site_id: string | null
  site_name: string | null
  size: string | null
  activity: string
  location: string
  unit: string | null
  observed_at: string
  equipment: string | null
  remarks: string | null
  created_by_id: string
  created_at: string
}

export interface CreateCommanderIntentBody {
  area_of_operation_id: string
  title: string
  objective: string
  end_state: string
  constraints?: string | null
}

export interface UpdateCommanderIntentBody {
  title?: string
  objective?: string
  end_state?: string
  constraints?: string | null
}

export interface CreatePacePlanBody {
  area_of_operation_id: string
  primary_plan: string
  alternate_plan: string
  contingency_plan: string
  emergency_plan: string
  notes?: string | null
}

export interface UpdatePacePlanBody {
  primary_plan?: string
  alternate_plan?: string
  contingency_plan?: string
  emergency_plan?: string
  notes?: string | null
}

export interface CreateSaluteReportBody {
  area_of_operation_id: string
  site_id?: string | null
  size?: string | null
  activity: string
  location: string
  unit?: string | null
  observed_at: string
  equipment?: string | null
  remarks?: string | null
}

export interface ChokepointsParams extends PaginationParams, AsOfParam {
  area_of_operation_id?: string
}

export interface CreateChokepointBody {
  area_of_operation_id: string
  name: string
  category: ChokepointCategory
  status: ChokepointStatus
  latitude: number
  longitude: number
  watch_radius_km: number
  notes?: string | null
}

export interface UpdateChokepointBody {
  name?: string
  category?: ChokepointCategory
  status?: ChokepointStatus
  latitude?: number
  longitude?: number
  watch_radius_km?: number
  notes?: string | null
}

export interface PlanningResponse {
  tasks:               Task[]
  assets:              Asset[]
  areas_of_operation:  PlanningAoStub[]
  chokepoints:         Chokepoint[]
  commander_intents:   CommanderIntent[]
  pace_plans:          PacePlan[]
  salute_reports:      SaluteReport[]
  open_incidents:      PlanningIncidentStub[]
  meta: {
    truncated: boolean
    task_count: number
    assets_truncated: boolean
    asset_count: number
    areas_truncated: boolean
    area_count: number
    chokepoints_truncated: boolean
    chokepoint_count: number
    intents_truncated: boolean
    intent_count: number
    pace_plans_truncated: boolean
    pace_plan_count: number
    incidents_truncated: boolean
    incident_count: number
    salute_reports_truncated: boolean
    salute_report_count: number
    salute_report_meta_by_ao: Record<string, { truncated: boolean; count: number }>
    as_of?: string | null
  }
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

export interface AuditEventsCursor {
  before_occurred_at: string
  before_id: string
}

export interface AuditEventsMeta {
  limit: number
  has_more: boolean
  next_cursor: AuditEventsCursor | null
}

export interface AuditEventsResponse {
  data: AuditEvent[]
  meta: AuditEventsMeta
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
  asset_id?: string | null
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
    // Task filters
    site_id:         string | null
    workflow_status: WorkflowStatus | null
    priority:        TaskPriority | null
    created_after:   string | null
    created_before:  string | null
    // Signal filters
    signal_type: SignalType | null
    source:      SignalSource | null
    from:        string | null
    to:          string | null
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
  summary:   string
  citations: string[]
  context_counts: {
    audit_events: number
    signals:      number
    rule_fires:   number
  }
}

export type AiOntologyRootType = 'site' | 'incident' | 'task' | 'asset' | 'area_of_operation'
export type AiOntologyNodeType = 'site' | 'area_of_operation' | 'incident' | 'task' | 'asset' | 'alert' | 'signal' | 'recommendation' | 'prosecution_step'
export type AiOntologyRelation =
  | 'area'
  | 'site'
  | 'sites'
  | 'incidents'
  | 'tasks'
  | 'asset'
  | 'assets'
  | 'alerts'
  | 'signals'
  | 'recommendations'
  | 'prosecution_steps'

export interface AiOntologyQueryRequest {
  q: string
  as_of?: string
}

export interface AiOntologyNode {
  id: string
  entity_id: string
  type: AiOntologyNodeType
  label: string
  sublabel: string
  root: boolean
  metadata: Record<string, string | number | boolean | null>
}

export interface AiOntologyEdge {
  source: string
  target: string
  relation: string
}

export interface AiOntologyQueryResult {
  original_query: string
  summary: string
  normalized_query: {
    root_type: AiOntologyRootType
    root_id: string
    root_label: string
    relations: AiOntologyRelation[]
    time_window_hours: number
    limit: number
    as_of?: string | null
  }
  nodes: AiOntologyNode[]
  edges: AiOntologyEdge[]
  counts: {
    node_count: number
    edge_count: number
    by_type: Partial<Record<AiOntologyNodeType, number>>
  }
}

// ---------------------------------------------------------------------------
// Signal types
// ---------------------------------------------------------------------------

export type SignalSource = 'opensky' | 'ais' | 'usgs_seismic' | 'gpsjam' | 'firms_wildfire' | 'manual' | 'derived' | 'acled' | 'gdacs'
export type SignalType = 'aircraft_position' | 'vessel_position' | 'seismic_event' | 'gps_jamming' | 'wildfire' | 'ais_gap' | 'manual' | 'conflict_event' | 'disaster_alert'

export type AlertStatus = 'unacknowledged' | 'acknowledged' | 'investigating' | 'closed'

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

// Compound (AND/OR) conditions — 2+ sub-conditions fused across signal types
export interface CompoundConditions {
  operator: 'AND' | 'OR'
  conditions: CorrelationConditions[]
}

// Wire type — either flat or compound; the backend accepts both
export type RuleConditions = CorrelationConditions | CompoundConditions

// Type guard — narrows RuleConditions to CompoundConditions
export function isCompoundRule(c: RuleConditions): c is CompoundConditions {
  return 'operator' in c && c.operator != null
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
  conditions: RuleConditions
  actions: CorrelationActions
  created_by_id: string
  area_of_operation_id: string | null
  cooldown_minutes: number
  last_fired_at: string | null
  mitre_tags: string[]
  created_at: string
  updated_at: string
}

export interface SignalRuleMatch {
  id: string
  fired_at: string
  confidence: number
  workflow_status: AlertStatus
  acknowledged_at: string | null
  acknowledged_by: { id: string; email: string } | null
  notes: string | null
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

export interface TransitionAlertBody {
  to_status: AlertStatus
  notes?: string | null
}

export interface AllowedTransitionsResponse {
  allowed: AlertStatus[]
}

export interface CreateCorrelationRuleBody {
  name: string
  description?: string | null
  is_active?: boolean
  conditions: RuleConditions
  actions: CorrelationActions
  cooldown_minutes?: number
  mitre_tags?: string[]
}

export interface UpdateCorrelationRuleBody {
  name?: string
  description?: string | null
  is_active?: boolean
  conditions?: RuleConditions
  actions?: CorrelationActions
  cooldown_minutes?: number
  mitre_tags?: string[]
}

export interface SignalsParams extends PaginationParams {
  source?: SignalSource
  signal_type?: SignalType
  from?: string
  to?: string
  site_id?: string
  as_of?: string
}

export interface SignalRuleMatchesParams extends PaginationParams {
  rule_id?: string
  site_id?: string
  signal_id?: string
  workflow_status?: AlertStatus
  /** When true, only return matches created by the geofence breach detector (not correlation rules). */
  geofence_breach?: boolean
  from?: string
  to?: string
  as_of?: string
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

export type RiskLevel = 'low' | 'moderate' | 'high' | 'critical'

export interface SiteRiskScore {
  site_id:    string
  site_name:  string
  score:      number
  risk_level: RiskLevel
  components: {
    alert_pressure:  number
    task_health:     number
    signal_density:  number
  }
  computed_at: string
}

export interface ThroughputPoint {
  date: string
  resolved: number
}

// ---------------------------------------------------------------------------
// Risk history types
// ---------------------------------------------------------------------------

export interface SiteRiskSnapshot {
  id:             string
  recorded_at:    string
  score:          number
  risk_level:     RiskLevel
  alert_pressure: number
  task_health:    number
  signal_density: number
}

export interface SiteRiskHistoryResponse {
  data: SiteRiskSnapshot[]
  meta: { total: number; site_id: string; days: number; as_of?: string | null }
}

export interface SiteRiskHistoryParams extends AsOfParam {
  days?: number
}

// ---------------------------------------------------------------------------
// Site timeline types
// ---------------------------------------------------------------------------

export type TimelineEventKind =
  | 'signal_detected'
  | 'rule_fired'
  | 'task_created'
  | 'task_transitioned'
  | 'site_event'

export interface TimelineEventMeta {
  // signal_detected
  signal_id?:   string
  signal_type?: string
  source?:      string
  distance_km?: number
  magnitude?:   string | number | null
  lat?:         string | number
  lng?:         string | number
  // rule_fired
  match_id?:      string
  rule_id?:       string
  rule_name?:     string
  actions_taken?: string[]
  // task_created / task_transitioned
  task_id?:         string
  task_title?:      string
  priority?:        string
  workflow_status?: string
  // audit-based
  audit_event_id?: string
  event_type?:     string
  action?:         string
  entity_type?:    string
  entity_id?:      string
}

export interface TimelineEvent {
  id:               string
  event_kind:       TimelineEventKind
  occurred_at:      string
  title:            string
  subtitle:         string | null
  actor:            string
  confidence?:      number
  workflow_status?: string
  meta:             TimelineEventMeta
}

export interface SiteTimelineResponse {
  data: TimelineEvent[]
  meta: { total: number; site_id: string; days: number; as_of?: string | null }
}

export interface SiteTimelineParams {
  days?:  number
  kinds?: TimelineEventKind[]
  as_of?: string
}

export interface SwimlaneLane {
  site_id: string
  site_name: string
  area_of_operation_id: string | null
  area_of_operation_name: string | null
  event_count: number
  visible_event_count: number
  last_event_at: string
  events: TimelineEvent[]
}

export interface SwimlaneResponse {
  data: SwimlaneLane[]
  meta: {
    days: number
    lane_limit: number
    lane_count: number
    total_events: number
    event_kinds: TimelineEventKind[]
    selected_site_ids: string[]
    as_of?: string | null
  }
}

export interface SwimlaneParams {
  days?: number
  kinds?: TimelineEventKind[]
  lane_limit?: number
  site_ids?: string[]
  as_of?: string
}
