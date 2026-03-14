import { api } from './client'
import type { QueryParams } from './client'
import type {
  Task,
  PaginatedResponse,
  PaginationParams,
  AsOfParam,
  CreateTaskBody,
  UpdateTaskBody,
  TransitionTaskBody,
  WorkflowStatus,
} from './types'

type TasksParams = PaginationParams &
  AsOfParam & {
    site_id?: string
    workflow_status?: WorkflowStatus
  }

export function getTasks(params?: TasksParams): Promise<PaginatedResponse<Task>> {
  return api.get('/api/tasks', params as QueryParams)
}

export function getTask(id: string, params?: AsOfParam): Promise<Task> {
  return api.get(`/api/tasks/${id}`, params as QueryParams)
}

export function createTask(body: CreateTaskBody): Promise<Task> {
  return api.post('/api/tasks', body)
}

export function updateTask(id: string, body: UpdateTaskBody): Promise<Task> {
  return api.put(`/api/tasks/${id}`, body)
}

export function transitionTask(id: string, body: TransitionTaskBody): Promise<Task> {
  return api.post(`/api/tasks/${id}/transition`, { transition: body })
}

export function getAllowedTransitions(id: string): Promise<{ allowed: WorkflowStatus[] }> {
  return api.get(`/api/tasks/${id}/allowed_transitions`)
}
