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
}

// ── API functions ─────────────────────────────────────────────────────────

export function getIncidents(params?: IncidentParams): Promise<PaginatedResponse<Incident>> {
  return api.get('/api/incidents', params as QueryParams)
}

export function getIncident(id: string): Promise<Incident> {
  return api.get(`/api/incidents/${id}`)
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

export function getIncidentNotes(id: string): Promise<IncidentNote[]> {
  return api.get(`/api/incidents/${id}/notes`)
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
}

export function getIncidentChain(id: string): Promise<IncidentChainResponse> {
  return api.get(`/api/incidents/${id}/chain`)
}
