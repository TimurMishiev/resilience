import { api } from './client'
import type {
  CommanderIntent,
  CreateCommanderIntentBody,
  CreatePacePlanBody,
  CreateSaluteReportBody,
  PacePlan,
  PlanningResponse,
  SaluteReport,
  UpdateCommanderIntentBody,
  UpdatePacePlanBody,
} from './types'

export function getPlanning(): Promise<PlanningResponse> {
  return api.get('/api/planning')
}

export function createCommanderIntent(body: CreateCommanderIntentBody): Promise<CommanderIntent> {
  return api.post('/api/commander_intents', { commander_intent: body })
}

export function updateCommanderIntent(id: string, body: UpdateCommanderIntentBody): Promise<CommanderIntent> {
  return api.patch(`/api/commander_intents/${id}`, { commander_intent: body })
}

export function createPacePlan(body: CreatePacePlanBody): Promise<PacePlan> {
  return api.post('/api/pace_plans', { pace_plan: body })
}

export function updatePacePlan(id: string, body: UpdatePacePlanBody): Promise<PacePlan> {
  return api.patch(`/api/pace_plans/${id}`, { pace_plan: body })
}

export function createSaluteReport(body: CreateSaluteReportBody): Promise<SaluteReport> {
  return api.post('/api/salute_reports', { salute_report: body })
}
