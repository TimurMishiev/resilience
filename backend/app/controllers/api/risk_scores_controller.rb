module Api
  # GET /api/risk_scores
  #
  # Returns threat-pressure risk scores for all sites.
  # Each score is computed from three components:
  #   - alert_pressure  (0–40)  — open SignalRuleMatches weighted by confidence
  #   - task_health     (0–30)  — inverted readiness (low readiness = high risk)
  #   - signal_density  (0–30)  — nearby ExternalSignals in the last 24h
  #
  # Risk levels: low | moderate | high | critical
  #
  # Note: no as_of replay support — risk scores are a live threat snapshot.
  # Replaying historical risk is non-trivial (would need historical signal/match counts)
  # and is deferred to a future iteration.
  class RiskScoresController < BaseController
    def index
      sites       = Site.all.includes(:tasks).order(:name)
      computed_at = Time.current

      # Preload alert matches and nearby signals in two bulk queries instead of
      # two queries per site (N×2 → 2 total).
      alert_window  = Risk::ScoringService::ALERT_WINDOW_HOURS.hours.ago
      signal_window = Risk::ScoringService::SIGNAL_WINDOW_HOURS.hours.ago

      all_matches = SignalRuleMatch
        .where.not(workflow_status: "closed")
        .where(fired_at: alert_window..computed_at)
        .pluck(:site_id, :confidence)
        .group_by(&:first)
        .transform_values { |rows| rows.map { |_, c| { confidence: c } } }

      # Compute a bounding box that covers all sites + radius to limit the signal fetch.
      lats = sites.map { |s| s.latitude.to_f }
      lngs = sites.map { |s| s.longitude.to_f }
      deg  = Risk::ScoringService::SIGNAL_RADIUS_KM / 111.0

      all_signals = ExternalSignal
        .where(occurred_at: signal_window..computed_at)
        .where(lat: (lats.min - deg)..(lats.max + deg), lng: (lngs.min - deg)..(lngs.max + deg))
        .pluck(:lat, :lng)
        .map { |lat, lng| { lat: lat.to_f, lng: lng.to_f } }

      result = sites.map do |site|
        readiness = Readiness::CalculationService.call(site: site, tasks: site.tasks)
        risk      = Risk::ScoringService.call(
          site:               site,
          readiness_score:    readiness.payload[:score],
          preloaded_matches:  all_matches[site.id] || [],
          preloaded_signals:  all_signals
        )

        risk.payload.merge(computed_at: computed_at.iso8601)
      end

      render json: result
    end
  end
end
