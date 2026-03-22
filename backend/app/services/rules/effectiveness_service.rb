module Rules
  # Computes per-rule effectiveness analytics via a single batch SQL query.
  # Returns stats for ALL correlation rules at once to avoid N+1 queries.
  #
  # Metrics (all rates are floats 0.0–1.0 or nil when denominator is zero):
  #   total_fires           — lifetime fire count
  #   fires_last_30d        — fires in last 30 days
  #   fires_last_7d         — fires in last 7 days
  #   avg_confidence        — average match confidence (0.0–1.0)
  #   task_creation_rate    — fraction of fires that produced a linked task
  #   task_resolution_rate  — fraction of rule-created tasks that reached resolved
  #   alert_closure_rate    — fraction of rule match alerts that reached closed
  #   avg_hours_to_ack      — average hours from fired_at to acknowledged_at
  #   low_value_flag        — true when rule fires repeatedly but produces no closures
  #                           or tasks (defensible proxy for a noisy/low-signal rule)
  #
  # Low-value threshold: >= LOW_VALUE_MIN_FIRES lifetime AND
  #   task_creation_rate < 0.20 AND alert_closure_rate < 0.20
  class EffectivenessService < ApplicationService
    LOW_VALUE_MIN_FIRES     = 5
    LOW_VALUE_MAX_TASK_RATE = 0.20
    LOW_VALUE_MAX_CLOSURE   = 0.20

    def call
      rows = ApplicationRecord.connection.exec_query(STATS_SQL)

      # Build sparkline lookup: rule_id → 30-element array (day -29 .. day 0)
      sparklines = build_sparklines

      stats = rows.map do |row|
        total          = row["total_fires"].to_i
        task_rate      = row["task_creation_rate"]&.to_f
        closure_rate   = row["alert_closure_rate"]&.to_f
        rule_id        = row["rule_id"]

        {
          rule_id:              rule_id,
          total_fires:          total,
          fires_last_30d:       row["fires_last_30d"].to_i,
          fires_last_7d:        row["fires_last_7d"].to_i,
          avg_confidence:       row["avg_confidence"]&.to_f,
          task_creation_rate:   task_rate,
          task_resolution_rate: row["task_resolution_rate"]&.to_f,
          alert_closure_rate:   closure_rate,
          avg_hours_to_ack:     row["avg_hours_to_ack"]&.to_f,
          low_value_flag:       low_value?(total, task_rate, closure_rate),
          sparkline:            sparklines[rule_id] || Array.new(30, 0)
        }
      end

      ServiceResult.success(stats: stats)
    end

    private

    # Returns hash of rule_id → [count_day_minus_29, ..., count_today] (30 integers).
    # Uses a single query across all rules; missing days are filled with 0.
    def build_sparklines
      rows = ApplicationRecord.connection.exec_query(SPARKLINE_SQL)
      # Group rows by rule_id
      by_rule = rows.each_with_object(Hash.new { |h, k| h[k] = {} }) do |row, acc|
        acc[row["rule_id"]][row["day_offset"].to_i] = row["count"].to_i
      end

      by_rule.transform_values do |offsets|
        # day_offset 0 = today → index 29; day_offset 29 = oldest → index 0
        (0..29).map { |i| offsets[29 - i] || 0 }
      end
    end

    def low_value?(fires, task_rate, closure_rate)
      return false if fires < LOW_VALUE_MIN_FIRES
      return false if task_rate.nil? || closure_rate.nil?

      task_rate < LOW_VALUE_MAX_TASK_RATE && closure_rate < LOW_VALUE_MAX_CLOSURE
    end

    # Per-day fire counts for the last 30 days across all rules.
    # day_offset 0 = today (UTC), 1 = yesterday, ..., 29 = 29 days ago.
    # Only rows with fires are returned; caller fills missing days with 0.
    #
    # Uses a DATE comparison so day_offset is always 0–29.  A timestamp
    # comparison (fired_at >= NOW() - INTERVAL '30 days') can include records
    # from calendar-day 30 (e.g. a fire at 22:00 on day-30 when NOW() is 21:00)
    # whose day_offset=30 would be silently dropped by build_sparklines.
    SPARKLINE_SQL = <<~SQL.freeze
      SELECT
        srm.correlation_rule_id                                     AS rule_id,
        (NOW()::date - srm.fired_at::date)                         AS day_offset,
        COUNT(*)                                                    AS count
      FROM signal_rule_matches srm
      WHERE srm.fired_at::date >= NOW()::date - INTERVAL '29 days'
        AND srm.correlation_rule_id IS NOT NULL
      GROUP BY srm.correlation_rule_id, day_offset
    SQL

    # Single query for all rules.
    # LEFT JOIN ensures rules with no fires still appear (all counts = 0, rates = nil).
    # Uses FILTER (WHERE ...) aggregate for windowed counts — more readable than subqueries.
    STATS_SQL = <<~SQL.freeze
      SELECT
        cr.id AS rule_id,

        COUNT(srm.id)                                                           AS total_fires,
        COUNT(srm.id) FILTER (WHERE srm.fired_at >= NOW() - INTERVAL '30 days') AS fires_last_30d,
        COUNT(srm.id) FILTER (WHERE srm.fired_at >= NOW() - INTERVAL '7 days')  AS fires_last_7d,

        ROUND(AVG(srm.confidence)::numeric, 2)                                  AS avg_confidence,

        ROUND(
          COUNT(srm.task_id)::numeric / NULLIF(COUNT(srm.id), 0),
          2
        )                                                                       AS task_creation_rate,

        ROUND(
          COUNT(t.id) FILTER (WHERE t.workflow_status = 'resolved')::numeric
            / NULLIF(COUNT(srm.task_id), 0),
          2
        )                                                                       AS task_resolution_rate,

        ROUND(
          COUNT(srm.id) FILTER (WHERE srm.workflow_status = 'closed')::numeric
            / NULLIF(COUNT(srm.id), 0),
          2
        )                                                                       AS alert_closure_rate,

        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (srm.acknowledged_at - srm.fired_at)) / 3600.0
          ) FILTER (WHERE srm.acknowledged_at IS NOT NULL)::numeric,
          1
        )                                                                       AS avg_hours_to_ack

      FROM correlation_rules cr
      LEFT JOIN signal_rule_matches srm ON srm.correlation_rule_id = cr.id
      LEFT JOIN tasks               t   ON t.id = srm.task_id
      GROUP BY cr.id
    SQL
  end
end
