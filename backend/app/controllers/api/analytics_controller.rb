module Api
  class AnalyticsController < BaseController
    # GET /api/analytics/throughput
    # Returns daily count of tasks resolved over the last 30 days.
    def throughput
      since = 30.days.ago.beginning_of_day

      rows = AuditEvent
        .where(entity_type: "Task", event_type: "transition")
        .where("after_snapshot->>'workflow_status' = ?", "resolved")
        .where("occurred_at >= ?", since)
        .group("DATE(occurred_at AT TIME ZONE 'UTC')")
        .order("DATE(occurred_at AT TIME ZONE 'UTC')")
        .count

      # Fill in zeros for days with no resolutions so the chart is continuous.
      data = (0..29).map do |offset|
        date = (Date.current - (29 - offset).days).to_s
        { date: date, resolved: rows[Date.parse(date)] || 0 }
      end

      render json: { data: data }
    end
  end
end
