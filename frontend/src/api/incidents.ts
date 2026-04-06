import { api } from './client'
import type { QueryParams } from './client'
import type { PaginatedResponse, PaginationParams } from './types'

// ── Types ──────────────────────────────────────────────────────────────────

export type IncidentStatus   = 'open' | 'acknowledged' | 'contained' | 'resolved' | 'closed'
export type IncidentSeverity = 'low' | 'moderate' | 'high' | 'critical'

export interface AssignedUser {
  id:    string
  email: string
  role:  string
}

export interface IncidentNote {
  id:         string
  body:       string
  author:     { id: string; email: string }
  created_at: string
}

export interface IncidentAlert {
  id:               string
  fired_at:         string
  workflow_status:  string
  confidence:       number
  geofence_breach:  boolean
  correlation_rule: { id: string; name: string } | null
  signal: {
    id:          string
    signal_type: string
    source:      string
    lat:         string | number
    lng:         string | number
    occurred_at: string
  } | null
}

export interface IncidentTask {
  id:              string
  title:           string
  workflow_status: string
  priority:        string
  asset_id:        string | null
}

// ── Prosecution types ──────────────────────────────────────────────────────

export type ProsecutionPhase = 'assessing' | 'executing' | 'concluded'
export type ProsecutionActionType =
  | 'phase_transition'
  | 'evidence_linked'
  | 'outcome_recorded'
  | 'note_added'

export interface ProsecutionEvidenceRefs {
  signal_ids?:         string[]
  match_ids?:          string[]
  task_ids?:           string[]
  recommendation_ids?: string[]
}

export interface ProsecutionStep {
  id:            string
  incident_id:   string
  actor:         { id: string; email: string }
  phase:         ProsecutionPhase
  action_type:   ProsecutionActionType
  notes:         string | null
  evidence_refs: ProsecutionEvidenceRefs
  occurred_at:   string
  created_at:    string
}

export interface AddProsecutionStepBody {
  phase:          ProsecutionPhase
  action_type:    ProsecutionActionType
  notes?:         string | null
  evidence_refs?: ProsecutionEvidenceRefs
}

export interface Incident {
  id:               string
  title:            string
  description:      string | null
  status:           IncidentStatus
  severity:         IncidentSeverity
  confidence:       number
  opened_at:        string
  acknowledged_at:  string | null
  closed_at:        string | null
  fusion_rationale: string | null
  alert_count:      number
  task_count:       number
  assigned_to:      AssignedUser | null
  assigned_at:      string | null
  site:             { id: string; name: string } | null
  area_of_operation: { id: string; name: string; posture: import('./types').Posture } | null
  // Prosecution — present on all responses, null when incident is not being prosecuted
  prosecution_phase:          ProsecutionPhase | null
  prosecution_initiated_at:   string | null
  prosecuted_by:              { id: string; email: string } | null
  created_at:       string
  updated_at:       string
  // only present in show response
  alerts?: IncidentAlert[]
  tasks?:  IncidentTask[]
}

export interface IncidentParams extends PaginationParams {
  status?:          IncidentStatus
  severity?:        IncidentSeverity
  site_id?:         string
  assigned_to_id?:  string
  as_of?:           string
}

// ── API functions ─────────────────────────────────────────────────────────

export function getIncidents(params?: IncidentParams): Promise<PaginatedResponse<Incident>> {
  return api.get('/api/incidents', params as QueryParams)
}

export function getIncident(id: string, params?: { as_of?: string | null }): Promise<Incident> {
  return api.get(`/api/incidents/${id}`, params as QueryParams)
}

export function updateIncident(id: string, body: Partial<Pick<Incident, 'title' | 'description' | 'severity'>>): Promise<Incident> {
  return api.patch(`/api/incidents/${id}`, { incident: body })
}

export function transitionIncident(id: string, to_status: IncidentStatus): Promise<Incident> {
  return api.post(`/api/incidents/${id}/transition`, { to_status })
}

export function getIncidentAllowedTransitions(id: string): Promise<{ allowed: IncidentStatus[] }> {
  return api.get(`/api/incidents/${id}/allowed_transitions`)
}

export function assignIncident(id: string, assignee_id: string | null): Promise<Incident> {
  return api.patch(`/api/incidents/${id}/assign`, { assignee_id })
}

export function getIncidentNotes(id: string, params?: { as_of?: string | null }): Promise<IncidentNote[]> {
  return api.get(`/api/incidents/${id}/notes`, params as QueryParams)
}

export function addIncidentNote(id: string, body: string): Promise<IncidentNote> {
  return api.post(`/api/incidents/${id}/notes`, { body })
}

// ── Intelligence chain ─────────────────────────────────────────────────────

export type ChainNodeType = 'signal' | 'rule' | 'alert' | 'incident' | 'task'

export interface ChainNodeData {
  label:       string
  // common optional fields
  status?:     string
  severity?:   string
  priority?:   string
  fired_at?:   string
  confidence?: number
  source?:     string
  occurred_at?: string
  lat?:        string
  lng?:        string
}

export interface ChainNode {
  id:   string
  type: ChainNodeType
  data: ChainNodeData
}

export interface ChainEdge {
  id:     string
  source: string
  target: string
  label:  string
}

export interface IncidentChainResponse {
  nodes: ChainNode[]
  edges: ChainEdge[]
  meta: { truncated: boolean; node_count: number }
}

export function getIncidentChain(id: string, params?: { as_of?: string | null }): Promise<IncidentChainResponse> {
  return api.get(`/api/incidents/${id}/chain`, params as QueryParams)
}

// ── Prosecution API ────────────────────────────────────────────────────────

export function initiateProsecution(id: string, notes?: string | null): Promise<Incident> {
  return api.post(`/api/incidents/${id}/prosecute`, { notes: notes ?? null })
}

export function getProsecutionSteps(id: string, params?: { as_of?: string | null }): Promise<ProsecutionStep[]> {
  return api.get(`/api/incidents/${id}/prosecution_steps`, params as QueryParams)
}

export function addProsecutionStep(id: string, body: AddProsecutionStepBody): Promise<ProsecutionStep> {
  return api.post(`/api/incidents/${id}/prosecution_steps`, body)
}
