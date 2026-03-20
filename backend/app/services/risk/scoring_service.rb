module Risk
  # Computes a threat-pressure risk score (0–100) for a single site.
  #
  # Three independent components, each capped at a maximum weight:
  #
  #   1. Alert pressure  (0–40) — sum of confidence scores of open SignalRuleMatches
  #      within 72h, multiplied by 20. Two high-confidence alerts ≈ cap.
  #
  #   2. Task health     (0–30) — (1.0 − readiness_score) × 30.
  #      A fully blocked/unresolved site (readiness=0) contributes the full 30 pts.
  #      Sites with no tasks contribute 0 (no task data ≠ high risk).
  #
  #   3. Signal density  (0–30) — count of ExternalSignals within SIGNAL_RADIUS_KM
  #      in the last 24h, multiplied by 2. 15 signals nearby ≈ cap.
  #      Uses bounding-box pre-filter + exact Haversine for correctness.
  #
  # Risk levels:  LOW 0–25 · MODERATE 26–50 · HIGH 51–75 · CRITICAL 76–100
  #
  # This service is pure — no side effects, no writes, safe to call in replay context.
  class ScoringService < ApplicationService
    ALERT_CAP           = 40
    TASK_HEALTH_CAP     = 30
    SIGNAL_DENSITY_CAP  = 30

    ALERT_MULTIPLIER    = 20.0
    SIGNAL_MULTIPLIER   =  2.0

    SIGNAL_RADIUS_KM    = 100.0
    SIGNAL_WINDOW_HOURS = 24
    ALERT_WINDOW_HOURS  = 72

    RISK_LEVELS = [
      { max: 25,  level: "low",      label: "LOW" },
      { max: 50,  level: "moderate", label: "MODERATE" },
      { max: 75,  level: "high",     label: "HIGH" },
      { max: 100, level: "critical", label: "CRITICAL" }
    ].freeze

    def initialize(site:, readiness_score: nil)
      @site            = site
      @readiness_score = readiness_score
    end

    def call
      score = total_score

      ServiceResult.success(
        site_id:    @site.id,
        site_name:  @site.name,
        score:      score,
        risk_level: resolve_level(score),
        components: {
          alert_pressure:  alert_score,
          task_health:     task_health_score,
          signal_density:  signal_density_score
        },
        computed_at: Time.current.iso8601
      )
    end

    private

    def total_score
      @total_score ||= (alert_score + task_health_score + signal_density_score).clamp(0, 100).round
    end

    # Sum of confidence scores for all non-closed matches in the past 72h.
    # Weighted heavily because a rule firing is an explicit operator-defined signal of danger.
    def alert_score
      @alert_score ||= begin
        confidences = SignalRuleMatch
          .for_site(@site.id)
          .where.not(workflow_status: "closed")
          .where(fired_at: ALERT_WINDOW_HOURS.hours.ago..Time.current)
          .pluck(:confidence)

        raw = confidences.sum * ALERT_MULTIPLIER
        raw.clamp(0, ALERT_CAP).round(2)
      end
    end

    # Inverted readiness — nil readiness (no tasks) contributes 0, not risk.
    def task_health_score
      @task_health_score ||= begin
        return 0.0 if @readiness_score.nil?

        ((1.0 - @readiness_score) * TASK_HEALTH_CAP).clamp(0, TASK_HEALTH_CAP).round(2)
      end
    end

    # Bounding-box pre-filter + exact Haversine to count nearby signals.
    # Using the shared Correlations::EvaluatorService.haversine_km avoids
    # duplicating the formula and keeps the math consistent across the codebase.
    def signal_density_score
      @signal_density_score ||= begin
        candidates = ExternalSignal
          .near_point(@site.latitude, @site.longitude, SIGNAL_RADIUS_KM)
          .where(occurred_at: SIGNAL_WINDOW_HOURS.hours.ago..Time.current)

        exact_count = candidates.count do |sig|
          Correlations::EvaluatorService.haversine_km(
            sig.lat.to_f, sig.lng.to_f,
            @site.latitude.to_f, @site.longitude.to_f
          ) <= SIGNAL_RADIUS_KM
        end

        raw = exact_count * SIGNAL_MULTIPLIER
        raw.clamp(0, SIGNAL_DENSITY_CAP).round(2)
      end
    end

    def resolve_level(score)
      RISK_LEVELS.find { |r| score <= r[:max] }&.fetch(:level) || "critical"
    end
  end
end
