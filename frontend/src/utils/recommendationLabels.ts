export type RecommendationType =
  | 'close_stale_alert'
  | 'acknowledge_alert'
  | 'escalate_incident'
  | 'create_task'
  | 'flag_site'
  | 'bulk_triage_alerts'

export const REC_TYPE_LABEL: Record<RecommendationType, string> = {
  close_stale_alert:  'Close Stale Alert',
  acknowledge_alert:  'Acknowledge Alert',
  escalate_incident:  'Escalate Incident',
  create_task:        'Create Task',
  flag_site:          'Flag Site',
  bulk_triage_alerts: 'Bulk Triage Alerts',
}
