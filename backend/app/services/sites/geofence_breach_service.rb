module Sites
  # Checks whether a newly ingested signal breaches the geofence radius of any
  # active monitored site and creates a SignalRuleMatch record for each breach.
  #
  # Called alongside the correlation engine after each signal is ingested, so
  # geofence alerts are raised even when no explicit correlation rule matches.
  #
  # Idempotent: a second call for the same (signal, site) pair is a no-op
  # because we guard with a uniqueness check before inserting.
  class GeofenceBreachService < ApplicationService
    def initialize(signal:)
      @signal = signal
    end

    def call
      breached = []

      Site.active.find_each do |site|
        next unless site.geofence_radius_km&.positive?

        distance_km = Correlations::EvaluatorService.haversine_km(
          site.latitude.to_f,  site.longitude.to_f,
          @signal.lat.to_f,    @signal.lng.to_f
        )

        next if distance_km > site.geofence_radius_km

        # Skip if a breach record already exists for this (signal, site) pair.
        next if SignalRuleMatch.exists?(
          signal_id:           @signal.id,
          site_id:             site.id,
          correlation_rule_id: nil
        )

        match = SignalRuleMatch.create!(
          signal:              @signal,
          correlation_rule_id: nil,
          site:                site,
          fired_at:            Time.current,
          confidence:          breach_confidence(distance_km, site.geofence_radius_km),
          metadata: {
            distance_km:    distance_km.round(2),
            signal_type:    @signal.signal_type,
            signal_source:  @signal.source,
            geofence_breach: true
          }
        )

        Sse::Broadcaster.instance.publish(
          event: "geofence_breach",
          data: {
            site_id:        site.id,
            site_name:      site.name,
            signal_id:      @signal.id,
            signal_type:    @signal.signal_type,
            distance_km:    distance_km.round(1),
            geofence_km:    site.geofence_radius_km,
            match_id:       match.id,
            fired_at:       Time.current.iso8601
          }
        )

        # Fuse this breach into an existing or new incident.
        Incidents::FusionService.call(match: match)

        breached << { site_id: site.id, match_id: match.id, distance_km: distance_km.round(1) }
      rescue ActiveRecord::RecordInvalid => e
        Rails.logger.warn "[GeofenceBreachService] skipped site=#{site.id} signal=#{@signal.id}: #{e.message}"
      end

      ServiceResult.success(breaches: breached, count: breached.size)
    end

    private

    # Confidence ranges from 1.0 (signal at site centre) to near 0 at the boundary.
    def breach_confidence(distance_km, radius_km)
      return 1.0 if radius_km.zero?
      (1.0 - distance_km / radius_km).clamp(0.0, 1.0).round(2)
    end
  end
end
