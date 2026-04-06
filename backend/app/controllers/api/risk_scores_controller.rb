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
  # Replay support: when ?as_of is provided, returns the latest SiteRiskSnapshot
  # recorded at or before the cutoff for each site (hourly snapshots from
  # Risk::SnapshotJob). This avoids recomputing historical signal/match counts.
  class RiskScoresController < BaseController
    def index
      authorize :risk_score, :index?

      scores = as_of ? replay_risk_scores : live_risk_scores
      render json: { data: scores, meta: { count: scores.size, as_of: as_of&.iso8601 } }
    end

    private

    def live_risk_scores
      sites       = policy_scope(Site).includes(:tasks).order(:name)
      computed_at = Time.current
      return [] if sites.empty?

      # Preload alert matches and nearby signals in two bulk queries instead of
      # two queries per site (N×2 → 2 total).
      alert_window  = Risk::ScoringService::ALERT_WINDOW_HOURS.hours.ago
      signal_window = Risk::ScoringService::SIGNAL_WINDOW_HOURS.hours.ago

      all_matches = SignalRuleMatch
        .where(site_id: sites.map(&:id))
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

      sites.map do |site|
        readiness = Readiness::CalculationService.call(site: site, tasks: site.tasks)
        risk      = Risk::ScoringService.call(
          site:               site,
          readiness_score:    readiness.payload[:score],
          preloaded_matches:  all_matches[site.id] || [],
          preloaded_signals:  all_signals
        )

        risk.payload.merge(computed_at: computed_at.iso8601)
      end
    end

    def replay_risk_scores
      cutoff   = as_of
      site_ids = policy_scope(Site).where("created_at <= ?", cutoff).pluck(:id)
      return [] if site_ids.empty?

      # Find the latest snapshot per site at or before the cutoff.
      # Uses a lateral join pattern via DISTINCT ON for efficiency.
      snapshots = SiteRiskSnapshot
        .where(site_id: site_ids)
        .where("recorded_at <= ?", cutoff)
        .select("DISTINCT ON (site_id) site_risk_snapshots.*")
        .order(:site_id, recorded_at: :desc)
        .includes(:site)

      snapshots.map do |snap|
        {
          site_id:    snap.site_id,
          site_name:  snap.site.name,
          score:      snap.score,
          risk_level: snap.risk_level,
          components: {
            alert_pressure: snap.alert_pressure.to_f,
            task_health:    snap.task_health.to_f,
            signal_density: snap.signal_density.to_f,
          },
          computed_at: snap.recorded_at.iso8601,
          as_of:       cutoff.iso8601,
        }
      end
    end
  end
end
