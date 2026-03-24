import type { QueryClient } from '@tanstack/react-query'
import { useEventSource, type ConnectionStatus } from './useEventSource'
import { AppToaster } from '../lib/toaster'
import { humanize, POSTURE_LABELS } from '../utils/humanize'

/**
 * Subscribes to the SSE stream and handles all server-push events:
 * - Invalidates React Query caches for affected resources
 * - Shows toast notifications for operator-visible events
 *
 * Extracted from AppShell to keep the shell component focused on layout.
 */
export function useSseEvents({
  enabled,
  queryClient,
}: {
  enabled: boolean
  queryClient: QueryClient
}): { status: ConnectionStatus } {
  return useEventSource({
    enabled,
    onEvent: (e) => {
      // Tasks and readiness are invalidated on every event
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['readiness'] })
      queryClient.invalidateQueries({ queryKey: ['planning'] })

      if (e.event === 'rule_fired') {
        const d = e.data as {
          rule_name:     string
          site_name:     string
          task_title:    string | null
          priority:      string | null
          signal_type:   string
          distance_km:   number
          confidence:    number | null
          actions_taken: string[]
        }
        queryClient.invalidateQueries({ queryKey: ['signal_rule_matches'] })
        queryClient.invalidateQueries({ queryKey: ['correlation_rules'] })
        queryClient.invalidateQueries({ queryKey: ['sites'] })
        queryClient.invalidateQueries({ queryKey: ['incidents'] })
        queryClient.invalidateQueries({ queryKey: ['recommendations'] })
        const confPct = d.confidence != null ? ` · ${Math.round(d.confidence * 100)}% conf` : ''
        AppToaster.then(t => t.show({
          message: `⚡ ${d.rule_name} fired near ${d.site_name} — ${d.signal_type}, ${d.distance_km} km${confPct}`,
          intent:  'warning',
          icon:    'lightning',
          timeout: 10_000,
        }))
      }

      if (e.event === 'alert_transitioned') {
        const d = e.data as {
          workflow_status: string
          acknowledged_by: string
          rule_name:       string | null
          site_name:       string | null
          notes:           string | null
        }
        queryClient.invalidateQueries({ queryKey: ['signal_rule_matches'] })
        const STATUS_ICON: Record<string, string> = {
          acknowledged: '👁', investigating: '🔍', closed: '✔', unacknowledged: '⚠',
        }
        const label   = humanize(d.workflow_status)
        const context = d.rule_name ?? 'alert'
        const site    = d.site_name ? ` @ ${d.site_name}` : ''
        const notes   = d.notes ? ` — "${d.notes}"` : ''
        AppToaster.then(t => t.show({
          message: `${STATUS_ICON[d.workflow_status] ?? '•'} ${context}${site} → ${label}${notes}`,
          intent:  d.workflow_status === 'closed' ? 'success' : d.workflow_status === 'investigating' ? 'primary' : 'none',
          icon:    d.workflow_status === 'closed' ? 'tick' : d.workflow_status === 'investigating' ? 'search' : 'eye-open',
          timeout: 6_000,
        }))
      }

      if (e.event === 'task_created') {
        const d = e.data as { title: string; priority: string; site_name: string | null }
        AppToaster.then(t => t.show({
          message: `✚ Task created: "${d.title}"${d.site_name ? ` @ ${d.site_name}` : ''} [${d.priority}]`,
          intent:  'success',
          icon:    'tick-circle',
          timeout: 6_000,
        }))
      }

      if (e.event === 'task_transitioned') {
        const d = e.data as { title: string; workflow_status: string; site_name: string | null }
        const STATUS_ICON: Record<string, string> = {
          resolved: '✔', blocked: '⛔', in_progress: '▶', triaged: '🔍', new: '•',
        }
        AppToaster.then(t => t.show({
          message: `${STATUS_ICON[d.workflow_status] ?? '•'} "${d.title}" → ${humanize(d.workflow_status)}${d.site_name ? ` @ ${d.site_name}` : ''}`,
          intent:  d.workflow_status === 'resolved' ? 'success' : d.workflow_status === 'blocked' ? 'danger' : 'none',
          icon:    d.workflow_status === 'resolved' ? 'tick' : d.workflow_status === 'blocked' ? 'ban-circle' : 'refresh',
          timeout: 6_000,
        }))
      }

      if (e.event === 'geofence_breach') {
        const d = e.data as { site_name: string; signal_type: string; distance_km: number }
        queryClient.invalidateQueries({ queryKey: ['incidents'] })
        queryClient.invalidateQueries({ queryKey: ['recommendations'] })
        AppToaster.then(t => t.show({
          message: `⚠ Geofence breach at ${d.site_name} — ${humanize(d.signal_type)} (${d.distance_km} km)`,
          intent:  'warning',
          icon:    'locate',
          timeout: 8_000,
        }))
      }

      if (e.event === 'posture_changed') {
        const d = e.data as { area_of_operation_id: string; name: string; posture: string }
        queryClient.invalidateQueries({ queryKey: ['areas_of_operation'] })
        queryClient.invalidateQueries({ queryKey: ['incidents'] })
        AppToaster.then(t => t.show({
          message: `🔰 ${d.name}: ROE posture → ${POSTURE_LABELS[d.posture] ?? d.posture}`,
          intent:  d.posture === 'weapons_free' ? 'danger' : d.posture === 'defensive' ? 'warning' : 'none',
          icon:    'shield',
          timeout: 10_000,
        }))
      }
    },
  })
}
