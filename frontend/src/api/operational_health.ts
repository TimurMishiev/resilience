import { api } from './client'

export interface FeedHealthEntry {
  feed: string
  status: string
  started_at: string
  finished_at: string
  duration_ms: number
  fetched_count: number
  ingested_count: number
  duplicate_count: number
  skipped_count: number
  error_count: number
  page_count: number
  query_box_count: number
  last_external_occurred_at?: string | null
  error_messages?: string[]
}

export interface OperationalStatusEntry {
  category: string
  key: string
  payload: Record<string, unknown>
  updated_at: string
}

export function getFeedHealth(): Promise<{ data: FeedHealthEntry[] }> {
  return api.get('/api/feed_health')
}

export function getOperationalHealth(): Promise<{ data: OperationalStatusEntry[] }> {
  return api.get('/api/operational_health')
}
