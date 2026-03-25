module Correlations
  # Evaluates all active CorrelationRules against a newly ingested Signal.
  # For each matching rule/site pair, delegates to RuleFiringService.
  #
  # Compound rule evaluation
  # ------------------------
  # Rules are always evaluated through normalized_conditions, which coerces
  # legacy flat rules into the canonical { "operator", "conditions" => [...] }
  # form. This means the evaluator never has to special-case the two formats.
  #
  # For each sub-condition in a compound rule:
  #   Direct path      — signal_type matches the incoming signal:
  #                      proximity, magnitude, and count_threshold are checked
  #                      against the incoming signal and recent DB history.
  #   Corroboration path — signal_type does NOT match the incoming signal:
  #                      the DB is queried for a recent signal of the required
  #                      type near the site. This is how compound rules fuse
  #                      cross-stream intelligence (e.g. AIS gap + GPS jamming).
  #
  # The operator (AND / OR) then determines whether all or any sub-conditions
  # must be satisfied before the rule fires.
  #
  # Haversine formula is exposed as a class method so RuleFiringService can
  # reuse it without an extra dependency.
  class EvaluatorService < ApplicationService
    EARTH_RADIUS_KM = 6371.0
    SIGNAL_CANDIDATE_BATCH_SIZE = 200

    def self.haversine_km(lat1, lng1, lat2, lng2)
      dlat = (lat2 - lat1) * Math::PI / 180.0
      dlng = (lng2 - lng1) * Math::PI / 180.0
      a = Math.sin(dlat / 2)**2 +
          Math.cos(lat1 * Math::PI / 180.0) *
          Math.cos(lat2 * Math::PI / 180.0) *
          Math.sin(dlng / 2)**2
      2.0 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a))
    end

    def initialize(signal:)
      @signal = signal
    end

    def call
      rules = CorrelationRule.active
      fired = []

      rules.each do |rule|
        next if rule.on_cooldown?

        norm     = rule.normalized_conditions
        operator = norm["operator"]   # "AND" or "OR"
        conds    = norm["conditions"]

        target_sites(rule).each do |site|
          results = conds.map { |cond| evaluate_single_condition(cond, site) }
          match   = operator == "OR" ? results.any? : results.all?

          next unless match

          Correlations::RuleFiringJob.perform_later(rule.id, @signal.id, site.id)
          fired << { rule_id: rule.id, site_id: site.id }
        end
      end

      ServiceResult.success(fired_count: fired.size, matches: fired)
    end

    private

    # ── Per-condition evaluation ───────────────────────────────────────────────

    # Returns true if this single condition is satisfied given the incoming
    # signal and the current site.
    def evaluate_single_condition(cond, site)
      signal_type = cond["signal_type"]

      # Corroboration path — this condition requires a *different* signal type.
      # Look for a recent signal of that type near the site in the DB.
      if signal_type.present? && signal_type != @signal.signal_type
        return corroborating_signal_exists?(cond, site)
      end

      # Direct path — the incoming signal satisfies the required type (or the
      # condition has no signal_type filter at all).
      proximity_ok?(cond, site) &&
        magnitude_ok?(cond)     &&
        count_ok?(cond, site)
    end

    # Query the DB for at least one (or count_threshold) recent signals of the
    # required type near the site. Called when a sub-condition targets a
    # signal type different from the one that triggered the evaluator.
    def corroborating_signal_exists?(cond, site)
      window_min   = cond["time_window_minutes"].to_i
      window_min   = 60 if window_min.zero?
      proximity_km = cond["proximity_km"].to_f
      threshold    = [ cond["count_threshold"].to_i, 1 ].max

      candidates = recent_signal_candidates(
        signal_type: cond["signal_type"],
        window_minutes: window_min,
        site: site,
        proximity_km: proximity_km,
      )

      threshold_met?(candidates, site, proximity_km, threshold)
    end

    # ── Shared helpers (direct path) ───────────────────────────────────────────

    def proximity_ok?(cond, site)
      km = cond["proximity_km"].to_f
      return true if km.zero?

      distance = self.class.haversine_km(
        site.latitude.to_f,  site.longitude.to_f,
        @signal.lat.to_f,    @signal.lng.to_f
      )
      distance <= km
    end

    def magnitude_ok?(cond)
      min = cond["magnitude_min"]
      return true if min.blank?
      @signal.magnitude.to_f >= min.to_f
    end

    def count_ok?(cond, site)
      threshold = cond["count_threshold"].to_i
      return true if threshold <= 1

      window_min   = cond["time_window_minutes"].to_i
      window_min   = 60 if window_min.zero?
      proximity_km = cond["proximity_km"].to_f

      recent_signals = recent_signal_candidates(
        signal_type: @signal.signal_type,
        window_minutes: window_min,
        site: site,
        proximity_km: proximity_km,
      )

      threshold_met?(recent_signals, site, proximity_km, threshold)
    end

    # ── Site targeting ─────────────────────────────────────────────────────────

    # Returns the set of sites this rule should be evaluated against.
    # Legacy flat rules can carry a site_id filter; compound rules scope via
    # area_of_operation_id (a model attribute) or default to all active sites.
    def target_sites(rule)
      site_id = rule.conditions["site_id"]
      return Site.where(id: site_id) if site_id.present?

      base = Site.active
      base = base.where(area_of_operation_id: rule.area_of_operation_id) if rule.area_of_operation_id.present?
      base
    end

    def recent_signal_candidates(signal_type:, window_minutes:, site:, proximity_km:)
      scope = ExternalSignal.where(
        signal_type: signal_type,
        occurred_at: window_minutes.minutes.ago..Time.current
      )

      return scope unless proximity_km.positive?
      scope.near_point(site.latitude, site.longitude, proximity_km)
    end

    def threshold_met?(scope, site, proximity_km, threshold)
      return scope.limit(threshold).pluck(:id).size >= threshold unless proximity_km.positive?

      matching_count = 0

      scope
        .select(:id, :lat, :lng)
        .find_in_batches(batch_size: SIGNAL_CANDIDATE_BATCH_SIZE) do |batch|
          batch.each do |signal|
            next unless self.class.haversine_km(
              site.latitude.to_f, site.longitude.to_f,
              signal.lat.to_f,    signal.lng.to_f
            ) <= proximity_km

            matching_count += 1
            return true if matching_count >= threshold
          end
        end

      false
    end
  end
end
