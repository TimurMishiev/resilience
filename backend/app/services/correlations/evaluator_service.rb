module Correlations
  # Evaluates all active CorrelationRules against a newly ingested Signal.
  # For each matching rule/site pair, delegates to RuleFiringService.
  #
  # Haversine formula is implemented here and exposed as a module method so
  # RuleFiringService can reuse it without an extra dependency.
  class EvaluatorService < ApplicationService
    EARTH_RADIUS_KM = 6371.0

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
      rules  = CorrelationRule.active
      fired  = []

      rules.each do |rule|
        next if rule.on_cooldown?
        next unless signal_type_matches?(rule)

        target_sites(rule).each do |site|
          next unless within_proximity?(site, rule)
          next unless count_threshold_met?(rule, site)
          next unless magnitude_threshold_met?(rule)

          result = Correlations::RuleFiringService.call(
            rule:   rule,
            signal: @signal,
            site:   site
          )
          fired << result.payload if result.success
        end
      end

      ServiceResult.success(fired_count: fired.size, matches: fired)
    end

    private

    def signal_type_matches?(rule)
      expected = rule.conditions["signal_type"]
      expected.blank? || expected == @signal.signal_type
    end

    def target_sites(rule)
      site_id = rule.conditions["site_id"]
      site_id.present? ? Site.where(id: site_id) : Site.active
    end

    def within_proximity?(site, rule)
      km = rule.conditions["proximity_km"].to_f
      return true if km.zero?

      distance = self.class.haversine_km(
        site.latitude.to_f,  site.longitude.to_f,
        @signal.lat.to_f, @signal.lng.to_f
      )
      distance <= km
    end

    def count_threshold_met?(rule, site)
      threshold = rule.conditions["count_threshold"].to_i
      return true if threshold <= 1

      window_min   = rule.conditions["time_window_minutes"].to_i
      window_min   = 60 if window_min.zero?
      proximity_km = rule.conditions["proximity_km"].to_f

      recent_signals = ExternalSignal.where(
        signal_type: @signal.signal_type,
        occurred_at: window_min.minutes.ago..Time.current
      )

      nearby_count = recent_signals.count do |s|
        self.class.haversine_km(
          site.latitude.to_f, site.longitude.to_f,
          s.lat.to_f, s.lng.to_f
        ) <= proximity_km
      end

      nearby_count >= threshold
    end

    def magnitude_threshold_met?(rule)
      min = rule.conditions["magnitude_min"]
      return true if min.blank?
      @signal.magnitude.to_f >= min.to_f
    end
  end
end
