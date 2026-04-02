module Api
  class AnalyticsController < BaseController
    skip_after_action :verify_authorized

    # GET /api/analytics/throughput
    # Returns daily count of tasks resolved over the last 30 days.
    def throughput
      since = 30.days.ago.beginning_of_day

      rows = AuditEvent
        .where(entity_type: "Task", event_type: "task.transitioned")
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
      render json: Analytics::SwimlaneService.call(
        days:       params[:days],
        kinds:      params[:kinds],
        lane_limit: params[:lane_limit],
        site_ids:   params[:site_ids]
      )
    end
  end
end
