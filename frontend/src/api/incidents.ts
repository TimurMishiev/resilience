import { api } from './client'
import type { QueryParams } from './client'
import type { PaginatedResponse, PaginationParams } from './types'

// ── Types ──────────────────────────────────────────────────────────────────

export type IncidentStatus   = 'open' | 'acknowledged' | 'contained' | 'resolved' | 'closed'
export type IncidentSeverity = 'low' | 'moderate' | 'high' | 'critical'

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
  site:             { id: string; name: string } | null
  area_of_operation: { id: string; name: string } | null
  created_at:       string
  updated_at:       string
  // only present in show response
  alerts?: IncidentAlert[]
  tasks?:  IncidentTask[]
}

export interface IncidentParams extends PaginationParams {
  status?:   IncidentStatus
  severity?: IncidentSeverity
  site_id?:  string
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
