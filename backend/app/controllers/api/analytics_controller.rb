module Api
  class AnalyticsController < BaseController
    # GET /api/analytics/throughput
    # Returns daily count of tasks resolved over the last 30 days.
    def throughput
      authorize :analytics, :throughput?
      since = 30.days.ago.beginning_of_day
      scoped_task_ids = policy_scope(Task).select(:id)

      rows = AuditEvent
        .where(entity_type: "Task", event_type: "task.transitioned")
        .where(entity_id: scoped_task_ids)
        .where("after_snapshot->>'workflow_status' = ?", "resolved")
        .where("occurred_at >= ?", since)
        .group(Arel.sql("DATE(occurred_at AT TIME ZONE 'UTC')"))
        .order(Arel.sql("DATE(occurred_at AT TIME ZONE 'UTC')"))
        .count

      # Fill in zeros for days with no resolutions so the chart is continuous.
      data = (0..29).map do |offset|
        date = (Date.current - (29 - offset).days).to_s
        { date: date, resolved: rows[Date.parse(date)] || 0 }
      end

      render json: { data: data }
    end

    # GET /api/analytics/swimlane
    # Returns recent per-site event lanes for the live swimlane page.
    def swimlane
      authorize :analytics, :swimlane?
      scoped_site_ids = policy_scope(Site).pluck(:id)
      requested_site_ids = Array(params[:site_ids]).map(&:to_s).reject(&:blank?)
      effective_site_ids = requested_site_ids.any? ? (requested_site_ids & scoped_site_ids.map(&:to_s)) : scoped_site_ids

      render json: Analytics::SwimlaneService.call(
        days:       params[:days],
        kinds:      params[:kinds],
        lane_limit: params[:lane_limit],
        site_ids:   effective_site_ids,
        as_of:      as_of
      )
    end
  end
end
